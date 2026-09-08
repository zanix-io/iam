import type { OAUTH_PROVIDERS, USER_STATUS } from '../utils/constants.ts'

declare global {
  /** An OAuth2 provider this project wires — see `utils/constants.ts`'s `OAUTH_PROVIDERS`. */
  type OauthProviders = typeof OAUTH_PROVIDERS[number]

  /** A `users` profile's status — see `utils/constants.ts`'s `USER_STATUS`. */
  type UserStatus = typeof USER_STATUS[number]
}
