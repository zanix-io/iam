import { assertEquals } from 'jsr:@std/assert@0.224'

/** The modules an app configures rather than forks. iam serves many apps: none of them may carry
 * a value that names, or only makes sense for, one consumer. */
const SHARED_MODULES = [
  'ui/sdk/login-flow.ts',
  'ui/sdk/otp-channel.ts',
  'ui/sdk/otp-flow-cache.ts',
  'ui/sdk/client-registry.ts',
  'ui/sdk/redirect-session-refresh-failure.ts',
  'ui/space/login-pages.ts',
]

/** Names of consumer apps, their cache namespaces and their route conventions. */
const CONSUMER_SPECIFIC = [/presenza/i, /seller/i, /b2b/i, /ops-console/i, /\bweb:/, /GiftMatch/i]

Deno.test('the shared login-flow modules name no consumer app', () => {
  const findings: string[] = []
  for (const path of SHARED_MODULES) {
    const text = Deno.readTextFileSync(path)
    for (const pattern of CONSUMER_SPECIFIC) {
      if (pattern.test(text)) findings.push(`${path}: ${pattern}`)
    }
  }
  assertEquals(findings, [])
})

Deno.test('the shared login-flow modules render no markup and bake in no message key', () => {
  // A formatter may be passed in (the app's own), but no copy or key of `iam`'s own catalog is
  // written into these modules: wording is the app's.
  const markup = /useIntl|className=|data-space|<\/[a-z]+>/
  const messageKey = /['"`](login|common|logout|totp|password|phone|consent)\/[a-z][a-z/-]*['"`]/
  const findings: string[] = []
  for (const path of SHARED_MODULES) {
    const text = Deno.readTextFileSync(path)
    if (markup.test(text) || messageKey.test(text)) findings.push(path)
  }
  assertEquals(findings, [])
})

function shippedSources(dir: string): string[] {
  const files: string[] = []
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory) {
      if (!['@tests', 'node_modules'].includes(entry.name)) files.push(...shippedSources(path))
    } else if (/\.(tsx?|json)$/.test(entry.name)) files.push(path)
  }
  return files
}

Deno.test('no shipped source names a consumer app, in code, comments or messages', () => {
  const apps = [/@presenza\//, /\bpresenza\b/i, /GiftMatch/i, /ops-console/i, /b2b-portal/i]
  const findings: string[] = []
  for (const path of [...shippedSources('ui'), ...shippedSources('src')]) {
    const text = Deno.readTextFileSync(path)
    for (const pattern of apps) {
      if (pattern.test(text)) findings.push(`${path}: ${pattern}`)
    }
  }
  assertEquals(findings, [])
})

/** Every file under `dir` (recursively) matching `accept`, skipping `node_modules`. */
function filesUnder(dir: string, accept: (name: string) => boolean): string[] {
  const files: string[] = []
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory) {
      if (entry.name !== 'node_modules') files.push(...filesUnder(path, accept))
    } else if (accept(entry.name)) files.push(path)
  }
  return files
}

/** The guard tests that hold consumer-name denylists as regexes (they must contain the names). */
const DENYLIST_HOLDERS = [
  'ui/@tests/unit/sdk/consumer-neutrality.test.ts',
  'ui/@tests/unit/sdk/messages.test.ts',
  'ui/@tests/unit/styles.test.ts',
]

Deno.test('no published doc, env example or test file names a consumer app', () => {
  const apps = [/@presenza\//, /\bpresenza\b/i, /GiftMatch/i, /ops-console/i, /b2b-portal/i]
  const rootFiles = [...Deno.readDirSync('.')]
    .filter((entry) =>
      entry.isFile &&
      (['CHANGELOG.md', 'README.md'].includes(entry.name) || /^\.env.*\.example$/.test(entry.name))
    )
    .map((entry) => entry.name)
  const surfaces = [
    ...rootFiles,
    ...filesUnder('docs', (name) => name.endsWith('.md')),
    ...filesUnder('src/@tests', (name) => /\.tsx?$/.test(name)),
    ...filesUnder('ui/@tests', (name) => /\.tsx?$/.test(name)),
  ].filter((path) => !DENYLIST_HOLDERS.includes(path))

  // The scan must actually reach every surface it claims to cover.
  for (const required of ['CHANGELOG.md', 'README.md', '.env.example']) {
    assertEquals(surfaces.includes(required), true, `${required} must be scanned`)
  }

  const findings: string[] = []
  for (const path of surfaces) {
    const text = Deno.readTextFileSync(path)
    for (const pattern of apps) {
      if (pattern.test(text)) findings.push(`${path}: ${pattern}`)
    }
  }
  assertEquals(findings, [])
})

Deno.test('no shipped source under ui/ or src/ uses a consumer-specific `web:` namespace', () => {
  const findings = [...shippedSources('ui'), ...shippedSources('src')]
    .filter((path) => /\bweb:/.test(Deno.readTextFileSync(path)))
  assertEquals(findings, [])
})
