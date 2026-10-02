import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@0.224'
import {
  buildServiceArgs,
  hydrate,
  isSafePackagePath,
  matchesChecksum,
  parsePackageLocation,
  parseServeArgs,
  resolveCacheDir,
} from '../../../serve.ts'

const LOCATION = { registry: 'https://jsr.test', version: '1.2.3' }

async function checksumOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `sha256-${
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }`
}

/** A fake registry serving `files` (package path to content), and what it was asked for. */
async function fakeRegistry(files: Record<string, string>, tamper?: string) {
  const manifest: Record<string, { size: number; checksum: string }> = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([path, content]) =>
        [path, { size: content.length, checksum: await checksumOf(content) }] as const
      ),
    ),
  )
  const requests: string[] = []
  const fetchFile = ((input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('_meta.json')) return Promise.resolve(Response.json({ manifest }))
    const path = decodeURIComponent(url.replace('https://jsr.test/@zanix/iam/1.2.3', ''))
    if (!(path in files)) return Promise.resolve(new Response('missing', { status: 404 }))
    return Promise.resolve(new Response(path === tamper ? 'tampered' : files[path]))
  }) as typeof fetch
  return { fetchFile, requests }
}

async function withCache(run: (cacheDir: string) => Promise<void>): Promise<void> {
  const cacheDir = await Deno.makeTempDir({ prefix: 'iam-serve-' })
  try {
    await run(cacheDir)
  } finally {
    await Deno.remove(cacheDir, { recursive: true })
  }
}

Deno.test('parsePackageLocation reads the version of a JSR URL, and nothing of a local file', () => {
  assertEquals(parsePackageLocation('https://jsr.io/@zanix/iam/1.0.4/serve.ts'), {
    registry: 'https://jsr.io',
    version: '1.0.4',
  })
  assertEquals(parsePackageLocation('file:///work/iam/serve.ts'), undefined)
  assertEquals(parsePackageLocation('https://jsr.io/@zanix/other/1.0.4/serve.ts'), undefined)
})

Deno.test('parseServeArgs separates its own options from the ones for deno', () => {
  assertEquals(
    parseServeArgs(['--env-file=a.env', '--env-file=b.env', '--worker', '--', '--cached-only']),
    { envFiles: ['a.env', 'b.env'], worker: true, denoArgs: ['--cached-only'] },
  )
  assertEquals(parseServeArgs(['--version=2.0.0', '--cache-dir=/c']), {
    envFiles: [],
    worker: false,
    version: '2.0.0',
    cacheDir: '/c',
    denoArgs: [],
  })
  let message = ''
  try {
    parseServeArgs(['--nope'])
  } catch (error) {
    message = (error as Error).message
  }
  assertStringIncludes(message, '--nope')
})

Deno.test('isSafePackagePath accepts package files and refuses anything that could leave the directory', () => {
  for (const path of ['/mod.ts', '/src/space/routes/[lang]/page.tsx', '/.dist/client/a.js']) {
    assertEquals(isSafePackagePath(path), true, path)
  }
  for (const path of ['mod.ts', '/../x', '/a/../b', '/a//b', '/a/./b', '/a\\b', '/', '/a\0']) {
    assertEquals(isSafePackagePath(path), false, JSON.stringify(path))
  }
})

Deno.test('matchesChecksum compares the sha256 sum JSR publishes', async () => {
  const bytes = new TextEncoder().encode('hello')
  assertEquals(await matchesChecksum(bytes, await checksumOf('hello')), true)
  assertEquals(await matchesChecksum(bytes, await checksumOf('hellO')), false)
})

Deno.test('resolveCacheDir prefers the option, then ZANIX_CACHE_DIR, then the XDG and home defaults', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name]
  assertEquals(resolveCacheDir('/opt', env({ ZANIX_CACHE_DIR: '/e' })), '/opt')
  assertEquals(resolveCacheDir(undefined, env({ ZANIX_CACHE_DIR: '/e' })), '/e')
  assertEquals(resolveCacheDir(undefined, env({ XDG_CACHE_HOME: '/x' })), '/x/zanix')
  assertEquals(resolveCacheDir(undefined, env({ HOME: '/home/u' })), '/home/u/.cache/zanix')
})

Deno.test('buildServiceArgs resolves env files against the caller and picks the entrypoint', () => {
  const options = parseServeArgs([
    '--env-file=.env',
    '--env-file=/abs/.env.x',
    '--',
    '--cached-only',
  ])
  const args = buildServiceArgs(options, '/srv/app')

  assertEquals(args[0], 'run')
  assertEquals(args.slice(-1), ['mod.ts'])
  assertEquals(args.includes('--env-file=/srv/app/.env'), true)
  assertEquals(args.includes('--env-file=/abs/.env.x'), true)
  assertEquals(args.indexOf('--cached-only') < args.indexOf('mod.ts'), true)
  assertEquals(buildServiceArgs(parseServeArgs(['--worker']), '/srv').slice(-1), ['worker.ts'])
})

Deno.test('hydrate downloads a version once, files with [brackets] included', async () => {
  await withCache(async (cacheDir) => {
    const { fetchFile, requests } = await fakeRegistry({
      '/mod.ts': 'export {}',
      '/src/space/routes/[lang]/page.tsx': 'export default 1',
    })

    const directory = await hydrate(LOCATION, cacheDir, fetchFile)

    assertEquals(directory, `${cacheDir}/iam/1.2.3`)
    assertEquals(await Deno.readTextFile(`${directory}/mod.ts`), 'export {}')
    assertEquals(
      await Deno.readTextFile(`${directory}/src/space/routes/[lang]/page.tsx`),
      'export default 1',
    )

    const before = requests.length
    assertEquals(await hydrate(LOCATION, cacheDir, fetchFile), directory)
    assertEquals(requests.length, before, 'a cached version must not touch the network')
  })
})

Deno.test('hydrate leaves nothing behind when a file does not match its checksum', async () => {
  await withCache(async (cacheDir) => {
    const { fetchFile } = await fakeRegistry({ '/mod.ts': 'a', '/worker.ts': 'b' }, '/worker.ts')

    await assertRejects(() => hydrate(LOCATION, cacheDir, fetchFile), Error, 'checksum')

    const leftovers = await Array.fromAsync(Deno.readDir(`${cacheDir}/iam`))

    assertEquals(leftovers.map((entry) => entry.name), [])
  })
})

Deno.test('hydrate refuses a manifest path that could escape the directory, before downloading anything', async () => {
  await withCache(async (cacheDir) => {
    const { fetchFile, requests } = await fakeRegistry({ '/mod.ts': 'a', '/../escape.ts': 'b' })

    await assertRejects(() => hydrate(LOCATION, cacheDir, fetchFile), Error, 'unsafe path')

    assertEquals(requests.length, 1, 'only the manifest was requested')
  })
})

Deno.test('hydrate reports a version the registry does not have', async () => {
  await withCache(async (cacheDir) => {
    const fetchFile = (() => Promise.resolve(new Response('', { status: 404 }))) as typeof fetch

    await assertRejects(() => hydrate(LOCATION, cacheDir, fetchFile), Error, 'was not found')
  })
})
