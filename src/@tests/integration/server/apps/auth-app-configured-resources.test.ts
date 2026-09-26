import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { getResourceFactory } from '@zanix/app/runtime'
import {
  GITHUB_OAUTH2_CLIENT_ID_ENV,
  GITHUB_OAUTH2_CLIENT_SECRET_ENV,
  GITHUB_OAUTH2_REDIRECT_URI_ENV,
  GOOGLE_OAUTH2_CLIENT_ID_ENV,
  GOOGLE_OAUTH2_CLIENT_SECRET_ENV,
  GOOGLE_OAUTH2_REDIRECT_URI_ENV,
} from '@zanix/auth'

/**
 * `auth.app.ts` declares its `googleOAuth2`/`githubOAuth2`/`captcha` resources at module load,
 * only for the providers whose env vars are set. This file sets all of them BEFORE importing the
 * manifest (one test file is one isolate, so the import below is the manifest's first and only evaluation);
 * the unconfigured shape is asserted in `auth-app.test.ts`.
 */
const ENV = {
  [GOOGLE_OAUTH2_CLIENT_ID_ENV]: 'google-client',
  [GOOGLE_OAUTH2_CLIENT_SECRET_ENV]: 'google-secret',
  [GOOGLE_OAUTH2_REDIRECT_URI_ENV]: 'https://iam.example/login/google/callback',
  [GITHUB_OAUTH2_CLIENT_ID_ENV]: 'github-client',
  [GITHUB_OAUTH2_CLIENT_SECRET_ENV]: 'github-secret',
  [GITHUB_OAUTH2_REDIRECT_URI_ENV]: 'https://iam.example/login/github/callback',
  RECAPTCHA_SECRET_KEY: 'recaptcha-secret',
}
const originalEnv = Object.fromEntries(Object.keys(ENV).map((key) => [key, Deno.env.get(key)]))
for (const [key, value] of Object.entries(ENV)) Deno.env.set(key, value)

const { default: authApp } = await import('server/apps/auth.app.ts')

// The environment is shared by every test file in the process (isolates are not): restore it as
// soon as the manifest has read it. The captcha adapter test below re-sets its own key.
function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) Deno.env.delete(key)
    else Deno.env.set(key, value)
  }
}
restoreEnv()
// deno-lint-ignore no-explicit-any
const resources = (authApp.definition as any).localResources as Record<
  string,
  { type: string; options: Record<string, unknown> }
>

Deno.test('auth.app.ts resources: Google OAuth2 is declared from its env vars, forced to the code flow', () => {
  assertEquals(resources.googleOAuth2, {
    type: 'oauth2-google',
    options: {
      clientId: 'google-client',
      clientSecret: 'google-secret',
      redirectUri: 'https://iam.example/login/google/callback',
      responseType: 'code',
    },
  })
})

Deno.test('auth.app.ts resources: GitHub OAuth2 is declared from its env vars', () => {
  assertEquals(resources.githubOAuth2, {
    type: 'oauth2-github',
    options: {
      clientId: 'github-client',
      clientSecret: 'github-secret',
      redirectUri: 'https://iam.example/login/github/callback',
    },
  })
})

Deno.test('auth.app.ts resources: a configured captcha provider declares the captcha resource, and its factory builds an adapter', async () => {
  assertEquals(resources.captcha, { type: 'captcha-provider', options: {} })
  const factory = getResourceFactory('captcha-provider')
  assert(factory)
  Deno.env.set('RECAPTCHA_SECRET_KEY', ENV.RECAPTCHA_SECRET_KEY)
  try {
    const adapter = await factory({})
    assert(adapter, 'the factory must return the resolved captcha adapter')
  } finally {
    restoreEnv()
  }
})
