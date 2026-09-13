/**
 * @module
 *
 * Everything a consumer needs to let a logged-in user deactivate/delete their OWN `iam` account —
 * the `./sdk/users` subpath. See `./sdk/login` for the flows (email OTP, Google OAuth2) that can
 * bring a deactivated account back.
 */
export { UsersClient } from './client/users.client.ts'
export type { MessageResponse } from './rtos/common.ts'
