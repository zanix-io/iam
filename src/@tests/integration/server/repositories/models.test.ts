import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import { ProgramModule } from '@zanix/datamaster'

import 'server/repositories/auth/model.defs.ts'
import 'server/repositories/users/model.defs.ts'
import 'server/repositories/roles/model.defs.ts'
import 'server/repositories/permissions/model.defs.ts'
import 'server/repositories/grant-access/model.defs.ts'
import authSeeders from 'server/repositories/auth/seeders/main.ts'
import usersSeeders from 'server/repositories/users/seeders/main.ts'
import rolesSeeders from 'server/repositories/roles/seeders/main.ts'
import permissionsSeeders from 'server/repositories/permissions/seeders/main.ts'
import grantAccessSeeders from 'server/repositories/grant-access/seeders/main.ts'
import authProd from 'server/repositories/auth/seeders/seeders.prod.ts'
import authDev from 'server/repositories/auth/seeders/seeders.dev.ts'
import usersProd from 'server/repositories/users/seeders/seeders.prod.ts'
import usersDev from 'server/repositories/users/seeders/seeders.dev.ts'
import rolesProd from 'server/repositories/roles/seeders/seeders.prod.ts'
import rolesDev from 'server/repositories/roles/seeders/seeders.dev.ts'
import permissionsProd from 'server/repositories/permissions/seeders/seeders.prod.ts'
import permissionsDev from 'server/repositories/permissions/seeders/seeders.dev.ts'
import grantAccessProd from 'server/repositories/grant-access/seeders/seeders.prod.ts'
import grantAccessDev from 'server/repositories/grant-access/seeders/seeders.dev.ts'
import { LOGIN_ACTIONS, NOTIFIERS, OAUTH_PROVIDERS, USER_STATUS } from 'utils/constants.ts'

/**
 * Every `model.defs.ts` registered into `@zanix/datamaster`'s real model registry (read back via
 * its public `ProgramModule.getMetadata()`): the collection names the repositories ask for, the
 * constraints that carry business rules (uniqueness, enums, data-protection policies), the index
 * callbacks, and the seeder lists registered alongside them. No database connection is involved;
 * the index callbacks are invoked against a recording stand-in for the Mongoose schema.
 */

/** Registered model metadata, read back loosely: each test asserts only the fields it names. */
type Model = {
  name: string
  // deno-lint-ignore no-explicit-any
  definition: Record<string, any>
  options?: unknown
  callback: (schema: unknown) => unknown
}
const models = Object.fromEntries(
  (ProgramModule.getMetadata().models as Model[]).map((model) => [model.name, model]),
)

function indexesOf(model: Model) {
  const indexes: unknown[][] = []
  const schema = { index: (...args: unknown[]) => indexes.push(args) }
  assertEquals(model.callback(schema), schema, 'the callback must return the schema it was given')
  return indexes
}

Deno.test('models: registers every collection the repositories read', () => {
  for (const name of ['auth', 'users', 'roles', 'permissions', 'grant_accesses']) {
    assert(models[name], `model "${name}" must be registered`)
  }
})

Deno.test('models/auth: emailKeyId is the unique lookup key; secrets carry protection policies', () => {
  const { definition } = models.auth
  assertEquals(definition.emailKeyId.unique, true)
  assertEquals(definition.email.required, true)
  for (const field of ['email', 'phone', 'password', 'totpSecret', 'oauthRefreshToken']) {
    assertEquals(typeof definition[field].get, 'function', `${field} must use a data-policy getter`)
  }
  assertEquals(definition.otpNotifier.enum, NOTIFIERS.filter((notifier) => notifier !== 'email'))
  assertEquals(definition.oauthProvider.enum, OAUTH_PROVIDERS)
  assertEquals(models.auth.options, { timestamps: true })
})

Deno.test('models/auth: the 2FA sub-schema restricts triggerOn to the known login actions', () => {
  const twoFactor = models.auth.definition.twoFactorAuthConfig
  const triggerOn = twoFactor.obj?.triggerOn ?? twoFactor.triggerOn
  assertEquals(triggerOn.enum, LOGIN_ACTIONS)
  assertEquals(triggerOn.required, true)
})

Deno.test('models/users: status is required, restricted to USER_STATUS and defaults to ACTIVE', () => {
  const { status, phoneNumber } = models.users.definition
  assertEquals([status.enum, status.default, status.required], [USER_STATUS, 'ACTIVE', true])
  assertEquals(typeof phoneNumber.get, 'function')
})

Deno.test('models/roles: one role per {code, tenantId} (a missing tenantId is the global scope)', () => {
  assertEquals(indexesOf(models.roles), [[{ code: 1, tenantId: 1 }, { unique: true }]])
  assertEquals(models.roles.definition.permissions.ref, 'permissions')
})

Deno.test('models/permissions: code is unique and isActive defaults to true', () => {
  const { code, isActive } = models.permissions.definition
  assertEquals([code.unique, code.required], [true, true])
  assertEquals([isActive.default, isActive.required], [true, true])
})

Deno.test('models/grant_accesses: one grant per {userId, resourceId, tenantId}; createdAt is grantedAt', () => {
  assertEquals(indexesOf(models.grant_accesses), [[
    { userId: 1, resourceId: 1, tenantId: 1 },
    { unique: true },
  ]])
  assertEquals(models.grant_accesses.options, { timestamps: { createdAt: 'grantedAt' } })
})

Deno.test('seeders: every model with a non-empty seeder list registers it under its own name', () => {
  const composed: Record<string, unknown[]> = {
    auth: authSeeders,
    users: usersSeeders,
    roles: rolesSeeders,
    permissions: permissionsSeeders,
    'grant_accesses': grantAccessSeeders,
  }
  const registered = Object.fromEntries(
    (ProgramModule.getMetadata().seeders as unknown as { model: string; handlers: unknown[] }[])
      .map(({ model, handlers }) => [model, handlers.length]),
  )
  const expected = Object.fromEntries(
    Object.entries(composed).filter(([, list]) => list.length).map(([name, list]) => [
      name,
      list.length,
    ]),
  )
  assertEquals(registered, expected)
})

Deno.test('seeders: outside ENV=production each list is its prod seeders followed by its dev seeders', () => {
  assertEquals(Deno.env.get('ENV'), undefined)
  assertEquals(authSeeders, [...authProd, ...authDev])
  assertEquals(usersSeeders, [...usersProd, ...usersDev])
  assertEquals(rolesSeeders, [...rolesProd, ...rolesDev])
  assertEquals(permissionsSeeders, [...permissionsProd, ...permissionsDev])
  assertEquals(grantAccessSeeders, [...grantAccessProd, ...grantAccessDev])
  assertEquals([grantAccessProd, grantAccessDev, rolesDev, permissionsDev], [[], [], [], []])
})
