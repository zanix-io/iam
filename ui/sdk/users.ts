/**
 * @module
 *
 * Everything a consumer needs to let a logged-in user deactivate/delete their OWN `iam` account —
 * the `./sdk/users` subpath. See `./sdk/login` for how a deactivated account comes back (an OTP
 * or OAuth2 login, then `LoginClient.confirmReactivation`).
 */
export { UsersClient } from './client/users.client.ts'
export type { MessageResponse } from './rtos/common.ts'
export {
  /** The shared base class every `iam` REST client extends — see its own doc. */
  IamApiClient,
} from './client/base.ts'
export type {
  /** Construction options every `iam` REST client accepts. */
  IamApiClientOptions,
} from './client/base.ts'
