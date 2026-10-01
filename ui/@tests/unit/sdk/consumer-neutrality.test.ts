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

Deno.test('no shipped source under ui/ or src/ uses a consumer-specific `web:` namespace', () => {
  const findings = [...shippedSources('ui'), ...shippedSources('src')]
    .filter((path) => /\bweb:/.test(Deno.readTextFileSync(path)))
  assertEquals(findings, [])
})
