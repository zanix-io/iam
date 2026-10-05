// deno-lint-ignore-file no-await-in-loop no-explicit-any
/**
 * Harness of the end-to-end tests (`src/@tests/functional/e2e/`): it starts the REAL iam REST server
 * (`support/server.ts`) as a child process on a throw-away MongoDB database and a free port, and
 * drives it over HTTP with tokens issued by iam's own login.
 *
 * Safety rules the harness enforces, so a test run can never touch real data:
 * - The database is named `znx_iam_test_<random>`, created by the run and dropped when it stops.
 *   `zanix_iam`, `presenza_iam_staff` or any other database is never named here.
 * - The child gets a CLEAN environment: only what is passed below plus `PATH`/`HOME`/`DENO_DIR`.
 *   Nothing from a developer's `.env` (SMTP, OAuth, JWT keys) reaches it.
 * - The JWT key and the data key are random per server and never printed.
 * - Redis is not used: the server runs on its in-memory fallback (a single instance), so there are no
 *   Redis keys to namespace or clean.
 * - The child runs with its own copy of `deno.lock`, so starting it can never modify the repo's.
 * - Every server is stopped in a `finally` (SIGTERM, then SIGKILL) and its database dropped; a
 *   SIGINT/SIGTERM to the test process stops every running server, drops its database and removes
 *   its lock copy before exiting. A drop that fails is reported on stderr, never swallowed.
 *
 * The tests are skipped unless `IAM_TEST_MONGO_URI` names a MongoDB the run may write to. It must
 * be a plain `mongodb://` URI to a loopback host (or any host when
 * `IAM_TEST_ALLOW_REMOTE_MONGO=true`) with NO database in its path: the harness picks the database
 * itself, so a URI that names one (`.../zanix_iam`) is refused instead of being trusted.
 */
import { createJWT } from '@zanix/auth'
import { ZanixMongoConnector } from '@zanix/datamaster'

/** The prefix of every database the harness creates, drops and opens; nothing else is ever touched. */
export const TEST_DB_PREFIX = 'znx_iam_test_'

/**
 * Checks the URI the tests may write to and answers it. Throws (the run fails loudly, it does not
 * skip) on a URI that could reach a database that is not throw-away.
 */
export function validateMongoUri(uri: string, env = Deno.env): string {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('[e2e] IAM_TEST_MONGO_URI is not a valid URI')
  }
  if (parsed.protocol !== 'mongodb:') {
    throw new Error('[e2e] IAM_TEST_MONGO_URI must be a plain mongodb:// URI')
  }
  if (!parsed.hostname) throw new Error('[e2e] IAM_TEST_MONGO_URI has no host')
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
  if (!loopback && env.get('IAM_TEST_ALLOW_REMOTE_MONGO') !== 'true') {
    throw new Error(
      `[e2e] IAM_TEST_MONGO_URI points at ${parsed.hostname}, not a loopback host; set ` +
        'IAM_TEST_ALLOW_REMOTE_MONGO=true if that MongoDB really is one the tests may write to',
    )
  }
  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    throw new Error(
      '[e2e] IAM_TEST_MONGO_URI must not name a database: the harness creates its own ' +
        `${TEST_DB_PREFIX}<random> and refuses to guess which one is safe`,
    )
  }
  return uri
}

/** The MongoDB the tests may write to; unset means the end-to-end tests are skipped. */
export const mongoUri: string | undefined = (() => {
  const uri = Deno.env.get('IAM_TEST_MONGO_URI')
  return uri ? validateMongoUri(uri) : undefined
})()

/** `ignore` option of every end-to-end `Deno.test`. */
export const e2eIgnore = !mongoUri

export const REPO_ROOT = new URL('../../../', import.meta.url).pathname

/** The first administrator every server is seeded with (`FIRST_ADMIN_*`). */
export const FIRST_ADMIN = {
  email: 'first.admin@iam-test.invalid',
  password: 'First-Admin-Passw0rd!',
}

/** A password that satisfies the default policy, for the accounts the tests register. */
export const TEST_PASSWORD = 'Test-Passw0rd-123!'

export const SUPERADMIN_ROLE_ID = '693000000000000000000201'

/** Reports a cleanup problem on stderr (a failed drop must be seen, never swallowed). */
const report = (message: string) => Deno.stderr.writeSync(new TextEncoder().encode(`${message}\n`))

const randomSecret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')

function freePort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

/** What a call to the server answered. */
export type Reply<T = Record<string, any>> = { status: number; body: T; headers: Headers }

/** The tokens of one login, with the claims of the access token decoded. */
export type Session = {
  email: string
  accessToken: string
  refreshToken: string
  /** Decoded payload of the access token (`sub`, `aud`, ...). */
  claims: { sub: string; aud: string[]; [claim: string]: unknown }
}

export function decodeClaims(jwt: string): Session['claims'] {
  const payload = jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')
  return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
}

/** The throw-away database, read and changed directly (bypassing iam) for what a test must set up
 * or check behind the API's back: a demoted account, a 1.x document, the audit collection. */
export type RawDb = {
  name: string
  /** An ObjectId from its hex string, for filters and values written straight to the database. */
  oid: (hex: string) => unknown
  col: (name: string) => any
  drop: () => Promise<void>
  close: () => Promise<void>
}

/**
 * `DATA_SECRET_KEY` is process-wide and shared by every raw connection in this process, and with
 * the test files that set their own. It is set while at least one raw database is open and the
 * variable was absent when the first opened, and removed when the last closes.
 */
let rawDbsOpen = 0
let keyWasAbsent = false

function acquireDataKey() {
  if (rawDbsOpen++ === 0) {
    keyWasAbsent = !Deno.env.get('DATA_SECRET_KEY')
    if (keyWasAbsent) Deno.env.set('DATA_SECRET_KEY', randomSecret())
  }
}

function releaseDataKey() {
  if (--rawDbsOpen === 0 && keyWasAbsent) Deno.env.delete('DATA_SECRET_KEY')
}

export async function openRawDb(dbName: string): Promise<RawDb> {
  if (!mongoUri) throw new Error('[e2e] IAM_TEST_MONGO_URI is not set')
  if (!dbName.startsWith(TEST_DB_PREFIX)) {
    throw new Error(`[e2e] refusing to open a database not named ${TEST_DB_PREFIX}*: ${dbName}`)
  }
  acquireDataKey()
  const connector = new ZanixMongoConnector({
    uri: mongoUri,
    seedModel: false,
    triggersModel: false,
    config: { dbName },
  })
  try {
    await connector.isReady
  } catch (error) {
    releaseDataKey()
    throw error
  }
  // A schema-less model, only to reach the connection: importing iam's own models here would run
  // their seeders against the database the server owns.
  const anyModel = connector.getModel('e2e_probe', { definition: {}, options: { strict: false } })
  return {
    name: dbName,
    oid: (hex) => new anyModel.base.Types.ObjectId(hex),
    col: (name) => anyModel.db.collection(name),
    drop: async () => {
      await anyModel.db.dropDatabase()
    },
    close: async () => {
      await (connector as unknown as { close: () => Promise<void> }).close()
      releaseDataKey()
    },
  }
}

export type StartOptions = {
  /** Extra environment for the server (the rate limits, for instance). */
  env?: Record<string, string>
  /** Seed the first administrator (default true). */
  firstAdmin?: boolean
  /** Use this existing throw-away database (`znx_iam_test_*`) instead of a new one, to start a
   * second server over what a first one left (`stop({ keepDatabase: true })`). */
  dbName?: string
}

export type Iam = {
  url: string
  dbName: string
  db: RawDb
  /** Calls the API. `token` is a bearer access token; `body` is sent as JSON; `query` as a query string. */
  call: (
    method: string,
    path: string,
    options?: {
      token?: string
      body?: unknown
      query?: Record<string, string | number>
      /** Extra request headers (an `X-Znx-Authorization` for a service credential, say). */
      headers?: Record<string, string>
    },
  ) => Promise<Reply>
  /** Signs in with a password through iam's own login. */
  login: (email: string, password?: string) => Promise<Session>
  /** Exchanges a refresh token for a new session. */
  refresh: (session: Session) => Promise<Session>
  /** Registers an account (needs `user-write`) with the test password and answers its `authId`,
   * `userId` and `roleIds` (the account keeps whatever default role iam gives it, none here). */
  register: (
    asToken: string,
    email: string,
    names?: { firstName?: string; lastName?: string },
  ) => Promise<{ authId: string; userId: string; roleIds: string[] }>
  /** The first administrator, signed in. */
  admin: Session
  /**
   * Signs an access token with the key of THIS server (HS256, `JWT_KEY`), as iam itself would. It
   * stands for a token from the same issuer, or from an app that shares `JWT_KEY`, whose `sub` is
   * not an iam account id (a service name): the only way a non-account token can reach these
   * routes, since a token signed with any other key or algorithm fails before iam's code runs.
   */
  signToken: (claims: { sub: string; type: 'user' | 'api'; aud: string[] }) => Promise<string>
  /** The last lines the server wrote, to explain a failure. */
  logs: () => string
  /** Stops the server and drops the database, unless `keepDatabase` (then the caller must drop it,
   * by passing it as `dbName` to a later server and stopping that one normally). */
  stop: (options?: { keepDatabase?: boolean }) => Promise<void>
}

/** The cleanups of the servers running now, run by the signal handlers. */
const running = new Set<(keepDatabase?: boolean) => Promise<void>>()
let signalsInstalled = false

function installSignalCleanup() {
  if (signalsInstalled) return
  signalsInstalled = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    try {
      Deno.addSignalListener(signal, async () => {
        await Promise.allSettled([...running].map((cleanup) => cleanup()))
        Deno.exit(signal === 'SIGINT' ? 130 : 143)
      })
    } catch { /* signals are not available on this platform */ }
  }
}

/**
 * Starts a server on a new database and signs the first administrator in. Always call `stop()` in a
 * `finally`.
 */
export async function startIam(options: StartOptions = {}): Promise<Iam> {
  if (!mongoUri) throw new Error('[e2e] IAM_TEST_MONGO_URI is not set')
  const dbName = options.dbName ??
    `${TEST_DB_PREFIX}${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  if (!dbName.startsWith(TEST_DB_PREFIX)) {
    throw new Error(`[e2e] refusing a database not named ${TEST_DB_PREFIX}*: ${dbName}`)
  }
  const port = freePort()
  const url = `http://127.0.0.1:${port}`
  const lockFile = await Deno.makeTempFile({ prefix: 'znx-iam-test-lock-', suffix: '.json' })
  await Deno.copyFile(`${REPO_ROOT}deno.lock`, lockFile)

  const env: Record<string, string> = {
    PATH: Deno.env.get('PATH') ?? '',
    HOME: Deno.env.get('HOME') ?? '',
    ...(Deno.env.get('DENO_DIR') ? { DENO_DIR: Deno.env.get('DENO_DIR') as string } : {}),
    ENV: 'production',
    PORT: String(port),
    MONGO_URI: mongoUri,
    MONGO_DB_NAME: dbName,
    JWT_KEY: randomSecret(),
    DATA_SECRET_KEY: randomSecret(),
    TEMPLATES_BACKEND: 'local',
    // The admin mutations and the anonymous sign-in limits are for tests that exercise them to set.
    ADMIN_MUTATION_RATELIMIT: '1000000',
    FREE_RATELIMIT: '100000',
    CRITICAL_RATELIMIT: '100000',
    // The per-session limit (100 requests) counts over this window; a short one keeps a scenario that
    // makes hundreds of calls from being throttled by a limit it is not testing.
    RATE_LIMIT_WINDOW_SECONDS: '1',
    ...(options.firstAdmin === false ? {} : {
      FIRST_ADMIN_EMAIL: FIRST_ADMIN.email,
      FIRST_ADMIN_PASSWORD: FIRST_ADMIN.password,
    }),
    ...options.env,
  }

  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', `--lock=${lockFile}`, `${REPO_ROOT}src/@tests/support/server.ts`],
    cwd: REPO_ROOT,
    clearEnv: true,
    env,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()

  // Keep the tail of the output for a failure message, and keep the pipes drained.
  const tail: string[] = []
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of stream) {
        tail.push(...decoder.decode(chunk).split('\n'))
        if (tail.length > 60) tail.splice(0, tail.length - 60)
      }
    } catch { /* the process ended */ }
  }
  const drains = [drain(child.stdout), drain(child.stderr)]

  let raw: RawDb | undefined
  let cleaned: Promise<void> | undefined
  const cleanup = (keepDatabase = false): Promise<void> =>
    cleaned ??= (async () => {
      running.delete(cleanup)
      try {
        child.kill('SIGTERM')
      } catch { /* already gone */ }
      const exited = await Promise.race([
        child.status,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ])
      if (exited === null) {
        try {
          child.kill('SIGKILL')
        } catch { /* already gone */ }
        await child.status
      }
      await Promise.allSettled(drains)
      try {
        raw ??= await openRawDb(dbName)
        if (!keepDatabase) await raw.drop()
      } catch (error) {
        report(`[e2e] could not drop ${dbName}; drop it by hand: ${(error as Error).message}`)
      }
      try {
        await raw?.close()
      } catch (error) {
        report(`[e2e] could not close the connection to ${dbName}: ${(error as Error).message}`)
      }
      await Deno.remove(lockFile).catch(() => {})
    })()
  running.add(cleanup)
  installSignalCleanup()

  try {
    const started = Date.now()
    for (;;) {
      if (Date.now() - started > 90_000) throw new Error('[e2e] the server did not start in 90s')
      try {
        const health = await fetch(`${url}/health`)
        await health.body?.cancel()
        if (health.ok) break
      } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    raw = await openRawDb(dbName)
  } catch (error) {
    await cleanup()
    throw new Error(`${(error as Error).message}\n${tail.join('\n').slice(-3000)}`)
  }

  const call: Iam['call'] = async (method, path, opts = {}) => {
    const query = opts.query
      ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))}`
      : ''
    const response = await fetch(`${url}/api${path}${query}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    const text = await response.text()
    let body: Reply['body'] = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { raw: text }
    }
    return { status: response.status, body, headers: response.headers }
  }

  const toSession = (email: string, body: Reply['body']): Session => ({
    email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    claims: decodeClaims(body.accessToken),
  })

  const login: Iam['login'] = async (email, password = TEST_PASSWORD) => {
    const reply = await call('POST', '/login/login', { body: { email, password } })
    if (reply.status !== 200) {
      throw new Error(
        `[e2e] login failed for ${email}: ${reply.status} ${JSON.stringify(reply.body)}`,
      )
    }
    return toSession(email, reply.body)
  }

  const refresh: Iam['refresh'] = async (session) => {
    const reply = await call('POST', '/login/refresh', { body: { token: session.refreshToken } })
    if (reply.status !== 200) {
      throw new Error(`[e2e] refresh failed: ${reply.status} ${JSON.stringify(reply.body)}`)
    }
    return toSession(session.email, reply.body)
  }

  const register: Iam['register'] = async (asToken, email, names = {}) => {
    // The person is found again by a surname no other account has: emails are stored masked and
    // `GET /users/search` does not return them, so the surname is the handle.
    const lastName = names.lastName ??
      `Surname${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
    const reply = await call('POST', '/users/register', {
      token: asToken,
      body: { email, password: TEST_PASSWORD, firstName: names.firstName ?? 'Test', lastName },
    })
    if (reply.status !== 200) {
      throw new Error(
        `[e2e] register failed for ${email}: ${reply.status} ${JSON.stringify(reply.body)}`,
      )
    }
    const found = await call('GET', '/users/search', { token: asToken, query: { query: lastName } })
    const person = found.body.docs?.[0]
    if (!person?.authId) throw new Error(`[e2e] registered ${email} but found no account for it`)
    return { authId: person.authId, userId: person.id, roleIds: person.roleIds }
  }

  // `/health` answers as soon as the server listens, which can be before the seeders have written
  // the first administrator: ready means that account can sign in.
  let admin: Session
  try {
    const started = Date.now()
    for (;;) {
      try {
        admin = await login(FIRST_ADMIN.email, FIRST_ADMIN.password)
        break
      } catch (error) {
        if (options.firstAdmin === false || Date.now() - started > 30_000) throw error
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
  } catch (error) {
    await cleanup()
    throw new Error(`${(error as Error).message}\n${tail.join('\n').slice(-2000)}`)
  }

  const signToken: Iam['signToken'] = (claims) =>
    createJWT({ ...claims, rateLimit: 100 } as never, env.JWT_KEY, { expiration: '1h' } as never)

  return {
    url,
    dbName,
    signToken,
    db: raw,
    call,
    login,
    refresh,
    register,
    admin,
    logs: () => tail.join('\n'),
    stop: (stopOptions) => cleanup(stopOptions?.keepDatabase),
  }
}

/** Asserts the reply is a refusal with `status` and the stable `code` (and returns the body). */
export function assertRefused(reply: Reply, status: number, code?: string): Reply['body'] {
  if (reply.status !== status || (code !== undefined && reply.body.code !== code)) {
    throw new Error(
      `expected ${status}${code ? ` ${code}` : ''}, got ${reply.status} ${
        JSON.stringify({ code: reply.body.code, message: reply.body.message })
      }`,
    )
  }
  return reply.body
}

/** Asserts the reply is a success (2xx) and returns the body. */
export function assertOk(reply: Reply): Reply['body'] {
  if (reply.status < 200 || reply.status > 299) {
    throw new Error(
      `expected success, got ${reply.status} ${
        JSON.stringify({ code: reply.body.code, message: reply.body.message })
      }`,
    )
  }
  return reply.body
}

/** Small helpers over the API that most scenarios need. */
export function toolbox(iam: Iam) {
  const codes = new Map<string, string>()
  const permissionId = async (code: string): Promise<string> => {
    if (!codes.has(code)) {
      const reply = await iam.call('GET', '/permissions', {
        token: iam.admin.accessToken,
        query: { limit: 100 },
      })
      for (const doc of assertOk(reply).docs) codes.set(doc.code, doc.id)
    }
    const id = codes.get(code)
    if (!id) throw new Error(`[e2e] no permission ${code}`)
    return id
  }
  return {
    permissionId,
    /** Creates a permission (as the first administrator) and answers its id. */
    createPermission: async (code: string, isActive = true) => {
      assertOk(
        await iam.call('POST', '/permissions', {
          token: iam.admin.accessToken,
          body: { code, name: `Perm ${code}`, description: `Permission ${code}`, isActive },
        }),
      )
      codes.clear()
      return await permissionId(code)
    },
    /** Creates a role carrying `permissionCodes` (as `token`, default the first administrator). */
    createRole: async (code: string, permissionCodes: string[], token = iam.admin.accessToken) => {
      const permissions = await Promise.all(permissionCodes.map(permissionId))
      const reply = await iam.call('POST', '/roles', {
        token,
        body: { name: `Role ${code}`, code, description: `Role ${code}`, permissions },
      })
      assertOk(reply)
      const found = await iam.call('GET', '/roles', {
        token: iam.admin.accessToken,
        query: { query: code },
      })
      return found.body.docs.find((doc: { code: string }) => doc.code === code).id as string
    },
    roleIdByCode: async (code: string) => {
      const found = await iam.call('GET', '/roles', {
        token: iam.admin.accessToken,
        query: { query: code },
      })
      return found.body.docs.find((doc: { code: string }) => doc.code === code)?.id as string
    },
    /** The role ids an account holds, read by the first administrator. */
    rolesOf: async (authId: string) =>
      (await iam.call('GET', `/roles/accounts/${authId}`, { token: iam.admin.accessToken })).body
        .roleIds as string[],
  }
}

/** Whether the `mongosh` binary is available (the migration scenarios run the documented commands). */
export const mongoshAvailable: boolean = (() => {
  try {
    return new Deno.Command('mongosh', { args: ['--version'], stdout: 'null', stderr: 'null' })
      .outputSync().success
  } catch {
    return false
  }
})()

/**
 * Runs `script` in the real `mongosh` against the database `dbName` of the test MongoDB and answers
 * what it printed (the value of the last expression). Used to run the commands the CHANGELOG tells
 * an operator to run, exactly as written.
 */
export async function mongosh(dbName: string, script: string): Promise<string> {
  if (!mongoUri) throw new Error('[e2e] IAM_TEST_MONGO_URI is not set')
  if (!dbName.startsWith('znx_iam_test_')) {
    throw new Error(
      `[e2e] refusing to run mongosh on a database not named znx_iam_test_*: ${dbName}`,
    )
  }
  const target = new URL(mongoUri)
  target.pathname = `/${dbName}`
  const output = await new Deno.Command('mongosh', {
    args: ['--quiet', target.toString(), '--eval', script],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  const text = new TextDecoder().decode(output.stdout)
  if (!output.success) {
    throw new Error(`[e2e] mongosh failed: ${new TextDecoder().decode(output.stderr)}`)
  }
  return text.trim()
}

/**
 * The `js` code blocks under one heading of a Markdown file, keyed by the bold label that opens
 * each step (`**1. Count before.**` is `1`, `**Rolling back to 1.2.0.**` is `Rolling back`); a step with several blocks has them joined in order.
 */
export function markdownSteps(markdown: string, heading: string): Record<string, string> {
  const start = markdown.indexOf(heading)
  if (start < 0) throw new Error(`[e2e] no heading ${heading}`)
  const rest = markdown.slice(start + heading.length)
  const end = rest.search(/\n###? /)
  const section = end < 0 ? rest : rest.slice(0, end)
  const steps: Record<string, string> = {}
  let label = ''
  let inBlock = false
  let block: string[] = []
  for (const line of section.split('\n')) {
    if (inBlock) {
      if (line.startsWith('```')) {
        steps[label] = steps[label] ? `${steps[label]}\n${block.join('\n')}` : block.join('\n')
        inBlock = false
      } else block.push(line)
      continue
    }
    const bold = line.match(/^\*\*(\d+)\.|^\*\*(Rolling back)/)
    if (bold) label = bold[1] ?? bold[2]
    if (line.startsWith('```js')) {
      inBlock = true
      block = []
    }
  }
  return steps
}
