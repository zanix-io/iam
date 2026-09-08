import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { HttpError } from '@zanix/errors'
import { NotifierProvider } from '@zanix/notifications'

import { UsersService } from 'server/interactors/users.interactor.ts'
import { PasswordService } from 'server/interactors/password.interactor.ts'
import { AuthRepository } from 'server/repositories/auth/entity.provider.ts'
import { UsersRepository } from 'server/repositories/users/entity.provider.ts'
import { fn, mapGetter, mockAccessor } from '../../helpers/mock.ts'

const baseAuth = (overrides: Record<string, unknown> = {}) => ({
  id: 'auth-1',
  email: 'jane@example.com',
  userId: 'user-1',
  ...overrides,
})

const baseUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  status: 'ACTIVE',
  phoneNumber: undefined,
  ...overrides,
})

const defaultAuthRepo = () => ({
  findByEmail: fn((..._args: unknown[]): unknown => undefined),
  findById: fn((..._args: unknown[]): unknown => baseAuth()),
  registerAuth: fn((..._args: unknown[]) => ({})),
})

const defaultUsersRepo = () => ({
  registerUser: fn((..._args: unknown[]): unknown => baseUser()),
  findById: fn((..._args: unknown[]): unknown => baseUser()),
  updateUser: fn((..._args: unknown[]) => ({})),
  searchUsers: fn((..._args: unknown[]) => ({ docs: [baseUser()], total: 1 })),
})

const defaultNotifier = () => ({
  email: fn((..._args: unknown[]) => {}),
})

const defaultPasswordService = () => ({
  recovery: fn((..._args: unknown[]) => ({ response: 'notification sent' })),
})

function buildService(opts: {
  authRepo?: Partial<ReturnType<typeof defaultAuthRepo>>
  usersRepo?: Partial<ReturnType<typeof defaultUsersRepo>>
  notifier?: Partial<ReturnType<typeof defaultNotifier>>
  passwordService?: Partial<ReturnType<typeof defaultPasswordService>>
  session?: Record<string, unknown>
} = {}) {
  const authRepo = { ...defaultAuthRepo(), ...opts.authRepo }
  const usersRepo = { ...defaultUsersRepo(), ...opts.usersRepo }
  const notifier = { ...defaultNotifier(), ...opts.notifier }
  const passwordService = { ...defaultPasswordService(), ...opts.passwordService }

  const service = new UsersService('ctx-1')
  mockAccessor(
    service,
    'providers',
    mapGetter([
      [AuthRepository, authRepo],
      [UsersRepository, usersRepo],
      [NotifierProvider, notifier],
    ]),
  )
  mockAccessor(service, 'interactors', mapGetter([[PasswordService, passwordService]]))
  mockAccessor(service, 'context', { session: opts.session ?? { subject: 'auth-1' } })

  return { service, authRepo, usersRepo, notifier, passwordService }
}

Deno.test('registerUser: throws CONFLICT when the email is already registered', async () => {
  const { service } = buildService({ authRepo: { findByEmail: fn(() => baseAuth()) } })
  await assertRejects(
    () => service.registerUser({ email: 'jane@example.com' } as never),
    HttpError,
    'already exists',
  )
})

Deno.test('registerUser: with a password, sets it directly and never invites via recovery', async () => {
  const { service, authRepo, passwordService, notifier } = buildService()
  const result = await service.registerUser({
    email: 'new@example.com',
    password: 'GoodPass1',
    firstName: 'New',
  } as never)
  assertEquals(result, { response: 'user registered' })
  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assertEquals(registered.password, 'GoodPass1')
  assertEquals(registered.mustChangePassword, true)
  assertEquals(registered.userId, 'user-1')
  assertEquals(passwordService.recovery.calls.length, 0)
  assertEquals(notifier.email.calls[0]?.[0] && true, true)
})

Deno.test('registerUser: without a password, invites the new account via the recovery flow', async () => {
  const { service, authRepo, passwordService } = buildService()
  await service.registerUser({ email: 'new@example.com' } as never)
  const registered = authRepo.registerAuth.calls[0]?.[0] as Record<string, unknown>
  assertEquals('password' in registered, false)
  assertEquals(passwordService.recovery.calls[0], ['new@example.com'])
})

Deno.test('getOwnProfile: throws UNAUTHORIZED with no session', async () => {
  const { service } = buildService({ session: {} })
  await assertRejects(() => service.getOwnProfile(), HttpError, 'Authentication required')
})

Deno.test('getOwnProfile: throws NOT_FOUND when the auth record has no linked profile', async () => {
  const { service } = buildService({
    authRepo: { findById: fn(() => baseAuth({ userId: undefined })) },
  })
  await assertRejects(() => service.getOwnProfile(), HttpError, 'No profile is linked')
})

Deno.test('getOwnProfile: returns the profile linked to the session subject', async () => {
  const { service, usersRepo } = buildService()
  const result = await service.getOwnProfile() as unknown as Record<string, unknown>
  assertEquals(result.id, 'user-1')
  assertEquals(usersRepo.findById.calls[0], ['user-1'])
})

Deno.test('updateOwnProfile: updates the profile resolved from the session, never status', async () => {
  const { service, usersRepo } = buildService()
  const result = await service.updateOwnProfile({ firstName: 'Updated' } as never)
  assertEquals(result, { response: 'profile updated' })
  const [update] = usersRepo.updateUser.calls[0] as [Record<string, unknown>]
  assertEquals(update.id, 'user-1')
  assertEquals(update.firstName, 'Updated')
  assertEquals('status' in update, false)
})

Deno.test('getUserById: throws NOT_FOUND when no profile exists', async () => {
  const { service } = buildService({ usersRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.getUserById('missing'), HttpError, 'not found')
})

Deno.test('updateUserById: throws NOT_FOUND when no profile exists', async () => {
  const { service } = buildService({ usersRepo: { findById: fn(() => undefined) } })
  await assertRejects(() => service.updateUserById('missing', {} as never), HttpError, 'not found')
})

Deno.test('updateUserById: setting status to INACTIVE persists it, with no separate auth-side revoke action', async () => {
  const { service, usersRepo } = buildService()
  const result = await service.updateUserById('user-1', { status: 'INACTIVE' } as never)
  assertEquals(result, { response: 'user updated' })
  // `AuthService`/`PasswordService`'s own `UsersRepository.assertActive` re-checks this same,
  // live `status` on every login/refresh attempt — no separate `AuthRepository` write is needed
  // here for a deactivation to take effect on the very next one. See `updateUserById`'s own doc.
  const [update] = usersRepo.updateUser.calls[0] as [Record<string, unknown>]
  assertEquals(update.status, 'INACTIVE')
})

Deno.test('searchUsers: returns paginated, adapted profiles', async () => {
  const { service } = buildService()
  const result = await service.searchUsers({})
  assertEquals(result.total, 1)
  assertEquals(result.docs[0].id, 'user-1')
})
