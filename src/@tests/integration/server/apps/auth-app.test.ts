import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { getResourceFactory } from '@zanix/app/runtime'
import { GitHubOAuth2Connector, GoogleOAuth2Connector } from '@zanix/auth'

import authApp from 'server/apps/auth.app.ts'

/**
 * Real-registration checks ("is this artifact actually wired into the real system", per
 * `zanix-test-tier-conventions`' Pattern A) — nothing mocked here, unlike the unit-tier
 * interactor tests, which deliberately can't exercise this module-load-time wiring in isolation.
 *
 * Related coverage: `setup` (template seeding through an injected `ctx.resolve`) in
 * `unit/server/apps/auth-app-setup.test.ts`; the `behaviors.*.default` functions in
 * `unit/server/apps/auth-app-behaviors.test.ts`; behaviors/config reaching the interactors in
 * `auth-app-wiring.test.ts`; env-configured resources in `auth-app-configured-resources.test.ts`.
 */

Deno.test('auth.app.ts: manifest shape — no HTTP surface, only the declared slots', () => {
  const def = authApp.definition
  assertEquals(def.name, 'auth')
  assertEquals(def.routesPrefix, null)
  assertEquals(Object.keys(def.dependencies).sort(), ['captcha', 'githubOAuth2', 'googleOAuth2'])
  // `totpToleranceSteps`/`selfRegistrationViaOAuth`/`selfRegistrationViaOTP` are `config` (plain
  // values), not `behaviors`; `behaviors` holds only the swappable strategy functions.
  assertEquals(
    Object.keys(def.behaviors).sort(),
    ['passwordPolicy', 'resolveEffectivePermissions', 'totpProvisioningLabel'],
  )
  assertEquals(
    Object.keys(def.config).sort(),
    ['defaultRoleId', 'selfRegistrationViaOAuth', 'selfRegistrationViaOTP', 'totpToleranceSteps'],
  )
  assertEquals(def.config.totpToleranceSteps.default, 1)
  assertEquals(def.config.selfRegistrationViaOAuth.default, true)
  assertEquals(def.config.selfRegistrationViaOTP.default, true)
})

Deno.test('auth.app.ts: registers real resource-type factories for both OAuth2 providers', () => {
  const google = getResourceFactory('oauth2-google')
  const github = getResourceFactory('oauth2-github')
  assert(google, 'oauth2-google factory must be registered')
  assert(github, 'oauth2-github factory must be registered')
})

Deno.test('auth.app.ts: the oauth2-google factory returns the real connector instance directly, no wrapper', async () => {
  const factory = getResourceFactory('oauth2-google')
  assert(factory)
  const resource = await factory({
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'https://iam.example/auth/google/callback',
    // Matches `auth.app.ts`'s own real `resources.googleOAuth2.options` — omitting this would
    // fall back to the base class's own 'token' (implicit-flow) default and log a real warning;
    // see that file's own doc for why 'code' is required here.
    responseType: 'code',
  })
  assert(resource instanceof GoogleOAuth2Connector, 'must be the real connector, not a wrapper')
  // `close()` is `protected` on `ZanixConnector` — the same cast `ResourceRegistry.close()` itself
  // uses (see `@zanix/app`'s own `resource-registry.ts`), not a workaround specific to this test.
  assertEquals(typeof (resource as unknown as { close: () => void }).close, 'function')
})

Deno.test('auth.app.ts: the oauth2-github factory returns the real connector instance directly, no wrapper', async () => {
  const factory = getResourceFactory('oauth2-github')
  assert(factory)
  const resource = await factory({
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'https://iam.example/auth/github/callback',
  })
  assert(resource instanceof GitHubOAuth2Connector, 'must be the real connector, not a wrapper')
  assertEquals(typeof (resource as unknown as { close: () => void }).close, 'function')
})
