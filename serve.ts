/**
 * Runs a published `@zanix/iam` without cloning its repository.
 *
 * `@zanix/server` finds a project's handlers, and `@zanix/space` its pages and assets, by reading
 * the project's source tree from disk, so `deno run jsr:@zanix/iam` has nothing to find. This
 * entrypoint downloads the files of one exact published version into a cache directory, checks
 * each one against the SHA-256 sum JSR publishes for it, and runs that directory as a normal
 * project: `mod.ts` (REST API, hosted pages) or, with `--worker`, `worker.ts` (background jobs).
 *
 * ```sh
 * deno run --allow-net --allow-env --allow-read --allow-write --allow-run \
 *   jsr:@zanix/iam@1.0.4/serve --env-file=.env
 * ```
 *
 * - `--env-file=<file>` (repeatable): env files for the service, resolved against the directory
 *   the command runs in.
 * - `--worker`: run the AsyncMQ worker process instead of the server.
 * - `--version=<x.y.z>`: the version to run when this file is not itself loaded from JSR.
 * - `--cache-dir=<dir>`: where versions are kept (`ZANIX_CACHE_DIR`, else `~/.cache/zanix`).
 * - Everything after `--` goes to the `deno run` that starts the service (`--cached-only`,
 *   `--minimum-dependency-age 0`, ...).
 *
 * A version is downloaded once. In a container, run this once at build time to fill the cache and
 * the service then starts without reaching JSR.
 *
 * @module
 */

/** The package this file belongs to. */
const SCOPE = '@zanix'
const NAME = 'iam'

/** Downloads in flight at once. */
const DOWNLOAD_CONCURRENCY = 8

/** What `deno run` is given to start the service, the same permissions as `deno task start`. */
const SERVICE_PERMISSIONS = [
  '--allow-net',
  '--allow-env',
  '--allow-read',
  '--allow-sys',
  '--allow-write',
  '--allow-ffi',
  '--allow-run=ffmpeg,ffprobe',
  '--no-prompt',
]

/** Where a published file lives, and the version it belongs to. */
export type PackageLocation = { registry: string; version: string }

/** The command line of this entrypoint. */
export type ServeOptions = {
  envFiles: string[]
  worker: boolean
  version?: string
  cacheDir?: string
  denoArgs: string[]
}

/** One entry of the `manifest` of a version's `_meta.json`. */
type ManifestEntry = { size: number; checksum: string }

/** The version a JSR URL of this package points at (`https://jsr.io/@zanix/iam/1.0.4/serve.ts`). */
export function parsePackageLocation(url: string): PackageLocation | undefined {
  const match = new URL(url).pathname.match(
    new RegExp(`^/${SCOPE}/${NAME}/(\\d+\\.\\d+\\.\\d+[^/]*)/`),
  )
  return match ? { registry: new URL(url).origin, version: match[1] } : undefined
}

/** Reads this entrypoint's command line. */
export function parseServeArgs(args: string[]): ServeOptions {
  const separator = args.indexOf('--')
  const own = separator === -1 ? args : args.slice(0, separator)
  const options: ServeOptions = {
    envFiles: [],
    worker: false,
    denoArgs: separator === -1 ? [] : args.slice(separator + 1),
  }

  for (const arg of own) {
    if (arg === '--worker') options.worker = true
    else if (arg.startsWith('--env-file=')) options.envFiles.push(arg.slice('--env-file='.length))
    else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length)
    else if (arg.startsWith('--cache-dir=')) options.cacheDir = arg.slice('--cache-dir='.length)
    else throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

/** Whether `path` is a file path inside the package: absolute, no `.`/`..`, no empty segment. */
export function isSafePackagePath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  return path.slice(1).split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Whether `bytes` hash to `expected`, a `sha256-<hex>` sum as JSR publishes it. */
export async function matchesChecksum(bytes: Uint8Array, expected: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
  return `sha256-${hex.join('')}` === expected
}

/** The directory versions are kept in. */
export function resolveCacheDir(
  option: string | undefined,
  env: (name: string) => string | undefined,
): string {
  const explicit = option ?? env('ZANIX_CACHE_DIR')
  if (explicit) return explicit
  const base = env('XDG_CACHE_HOME') ?? `${env('HOME') ?? env('USERPROFILE') ?? '.'}/.cache`
  return `${base}/zanix`
}

/** The arguments of the `deno run` that starts the service. */
export function buildServiceArgs(options: ServeOptions, cwd: string): string[] {
  const envFiles = options.envFiles.map((file) =>
    `--env-file=${file.startsWith('/') ? file : `${cwd}/${file}`}`
  )
  return [
    'run',
    ...SERVICE_PERMISSIONS,
    ...envFiles,
    ...options.denoArgs,
    options.worker ? 'worker.ts' : 'mod.ts',
  ]
}

/** Encodes each segment of a package path, so `[lang]` stays one segment in a URL. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Runs `task` over `items`, at most `limit` at a time. After the first failure no new item starts,
 * and the returned promise rejects only once every task in flight has finished, so a caller that
 * cleans up on failure never races a write that is still running.
 */
async function inParallel<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  let failure: unknown
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]
      try {
        // Deliberately sequential per worker: each one takes the next item only when it is free.
        // deno-lint-ignore no-await-in-loop
        await task(item)
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failed) throw failure
}

/**
 * Makes sure the files of `location` are in `cacheDir`, downloading them when they are not, and
 * returns their directory. Every file is checked against the sum of the version's manifest before
 * anything is moved into place, so a failed or tampered download leaves nothing behind.
 */
export async function hydrate(
  location: PackageLocation,
  cacheDir: string,
  fetchFile: typeof fetch = fetch,
): Promise<string> {
  const target = `${cacheDir}/${NAME}/${location.version}`
  try {
    if ((await Deno.stat(target)).isDirectory) return target
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }

  const base = `${location.registry}/${SCOPE}/${NAME}/${location.version}`
  const metaResponse = await fetchFile(`${base}_meta.json`)
  if (!metaResponse.ok) {
    throw new Error(`${SCOPE}/${NAME}@${location.version} was not found (${metaResponse.status}).`)
  }
  const manifest = (await metaResponse.json()).manifest as Record<string, ManifestEntry>
  const paths = Object.keys(manifest ?? {})
  if (paths.length === 0) throw new Error(`The manifest of ${NAME}@${location.version} is empty.`)
  for (const path of paths) {
    if (!isSafePackagePath(path)) {
      throw new Error(`Refusing an unsafe path in the manifest: ${path}`)
    }
  }

  await Deno.mkdir(`${cacheDir}/${NAME}`, { recursive: true })
  const staging = await Deno.makeTempDir({ dir: `${cacheDir}/${NAME}`, prefix: '.download-' })
  try {
    await inParallel(paths, DOWNLOAD_CONCURRENCY, async (path) => {
      const response = await fetchFile(`${base}${encodePath(path)}`)
      if (!response.ok) throw new Error(`Downloading ${path} failed (${response.status}).`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!(await matchesChecksum(bytes, manifest[path].checksum))) {
        throw new Error(`${path} does not match the checksum JSR publishes for it.`)
      }
      const file = `${staging}${path}`
      await Deno.mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
      await Deno.writeFile(file, bytes)
    })
    await Deno.rename(staging, target)
  } catch (error) {
    await Deno.remove(staging, { recursive: true }).catch(() => {})
    // Another process may have finished the same version first.
    if (await Deno.stat(target).then((info) => info.isDirectory, () => false)) return target
    throw error
  }
  return target
}

/** Starts the service from its cache directory and resolves with its exit code. */
async function main(args: string[]): Promise<number> {
  const options = parseServeArgs(args)
  const own = parsePackageLocation(import.meta.url)
  const location = own ??
    (options.version
      ? { registry: Deno.env.get('JSR_URL') ?? 'https://jsr.io', version: options.version }
      : undefined)
  if (!location) {
    throw new Error(
      `Run this from JSR, deno run jsr:${SCOPE}/${NAME}@<version>/serve, or pass --version=<x.y.z>.`,
    )
  }

  const cacheDir = resolveCacheDir(options.cacheDir, (name) => Deno.env.get(name))
  const directory = await hydrate(location, cacheDir)

  const child = new Deno.Command(Deno.execPath(), {
    args: buildServiceArgs(options, Deno.cwd()),
    cwd: directory,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    Deno.addSignalListener(signal, () => child.kill(signal))
  }
  return (await child.status).code
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args))
  } catch (error) {
    // A bootstrap script: one line on stderr, without loading the logger before anything is cached.
    Deno.stderr.writeSync(
      new TextEncoder().encode(`${error instanceof Error ? error.message : error}\n`),
    )
    Deno.exit(1)
  }
}
