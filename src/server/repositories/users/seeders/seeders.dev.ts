import { seedManyByIdIfMissing } from '@zanix/datamaster'

/**
 * Local-dev-only profile id, linked from `auth/seeders/seeders.dev.ts`'s own `DEV_AUTH_ID` via
 * `AuthenticationAttrs.userId`. Like `DEV_AUTH_ID` itself, this MUST be a real 24-character hex
 * ObjectId: it's assigned to `auth.userId`, a `Schema.Types.ObjectId`-typed field that fails to
 * cast anything else — the same constraint applies to every `ref: 'users'`/`ref: 'roles'` dev
 * seed id.
 */
export const DEV_USER_ID = '693000000000000000000001'

const data = [{
  id: DEV_USER_ID,
  firstName: 'Dev',
  lastName: 'User',
}]

/** This project's dev-only bootstrap `users` profile (`DEV_USER_ID`), upserted on boot via
 * `seedManyByIdIfMissing` when `ENV` isn't `'production'` (see `utils/seeders.ts`). */
export default [
  {
    handler: seedManyByIdIfMissing(data, { useDataPolicies: true }),
    options: { version: '1.0.0' },
  } as const,
] as never[]
