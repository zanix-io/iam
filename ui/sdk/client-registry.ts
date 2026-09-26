import { LoginClient } from './client/login.client.ts'
import { OtpClient } from './client/otp.client.ts'
import { PasswordClient } from './client/password.client.ts'
import { PhoneClient } from './client/phone.client.ts'
import { TotpClient } from './client/totp.client.ts'
import { UsersClient } from './client/users.client.ts'

/** The get/set/reset accessors of one client, named after it: `getLoginClient`,
 * `setLoginClientFactory`, `resetLoginClientFactory`. */
export type ClientSeams<Name extends string, Client> =
  & { [K in `get${Name}Client`]: () => Client }
  & { [K in `set${Name}ClientFactory`]: (factory: () => Client) => void }
  & { [K in `reset${Name}ClientFactory`]: () => void }

/** What {@linkcode createIamClientRegistry} returns. */
export type IamClientRegistry =
  & ClientSeams<'Login', LoginClient>
  & ClientSeams<'Otp', OtpClient>
  & ClientSeams<'Totp', TotpClient>
  & ClientSeams<'Phone', PhoneClient>
  & ClientSeams<'Password', PasswordClient>
  & ClientSeams<'Users', UsersClient>

/** A swappable factory: `get` builds (or returns the swapped-in) client, `set` replaces the
 * factory, `reset` restores the default one. */
function seam<T>(build: () => T) {
  let factory = build
  return {
    get: (): T => factory(),
    set: (replacement: () => T): void => {
      factory = replacement
    },
    reset: (): void => {
      factory = build
    },
  }
}

/**
 * The `iam` clients of one deployment, each behind a get/set/reset seam so a test can swap a fake
 * in without touching the network. Every client is `iam`'s own class, bound to the base URL that
 * `baseUrl` resolves to when a client is first built (not when the registry is created), so a
 * missing environment variable fails at the first use with the consumer's own error message.
 *
 * Destructure the accessors an app needs:
 *
 * ```ts
 * export const { getLoginClient, setLoginClientFactory, resetLoginClientFactory } =
 *   createIamClientRegistry({ baseUrl: requireIamServiceBaseUrl })
 * ```
 * @param options.baseUrl - Resolves `iam`'s REST API base URL (its `globalPrefix` included).
 */
export function createIamClientRegistry(options: { baseUrl: () => string }): IamClientRegistry {
  const build = <T>(Client: new (options: { baseUrl: string }) => T) => () =>
    new Client({ baseUrl: options.baseUrl() })
  const login = seam(build(LoginClient))
  const otp = seam(build(OtpClient))
  const totp = seam(build(TotpClient))
  const phone = seam(build(PhoneClient))
  const password = seam(build(PasswordClient))
  const users = seam(build(UsersClient))

  return {
    getLoginClient: login.get,
    setLoginClientFactory: login.set,
    resetLoginClientFactory: login.reset,
    getOtpClient: otp.get,
    setOtpClientFactory: otp.set,
    resetOtpClientFactory: otp.reset,
    getTotpClient: totp.get,
    setTotpClientFactory: totp.set,
    resetTotpClientFactory: totp.reset,
    getPhoneClient: phone.get,
    setPhoneClientFactory: phone.set,
    resetPhoneClientFactory: phone.reset,
    getPasswordClient: password.get,
    setPasswordClientFactory: password.set,
    resetPasswordClientFactory: password.reset,
    getUsersClient: users.get,
    setUsersClientFactory: users.set,
    resetUsersClientFactory: users.reset,
  }
}
