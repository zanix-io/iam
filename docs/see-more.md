## See More

Where each concern is implemented, for reading the source's own doc comments. Behavior is described
once in the guides linked from each section; this page only maps concerns to files.

### Sign-in and sessions

Described in [Authentication flows](./authentication-flows.md).

| Concern                                                                                                  | Source                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Password, one-time code, authenticator and OAuth2 sign-in; refresh; reactivation; sign-in methods; phone | [`AuthService`](../src/server/interactors/auth.interactor.ts)                                                                                 |
| Password change, add, remove, recovery; one-time code dispatch                                           | [`PasswordService`](../src/server/interactors/password.interactor.ts)                                                                         |
| Hosted OAuth2 provider                                                                                   | [`OAuthProviderService`](../src/server/interactors/oauth-provider.interactor.ts), [`utils/oauth-provider.ts`](../src/utils/oauth-provider.ts) |
| Refresh rate-limit identity                                                                              | [`utils/refresh-rate-limit-guard.ts`](../src/utils/refresh-rate-limit-guard.ts)                                                               |
| Phone-confirmation attempt ceiling                                                                       | [`utils/phone-confirm-rate-limit-guard.ts`](../src/utils/phone-confirm-rate-limit-guard.ts)                                                   |
| TOTP QR code                                                                                             | [`utils/qr-code.ts`](../src/utils/qr-code.ts)                                                                                                 |
| Env var names, rate-limit tiers, redirect safety                                                         | [`utils/constants.ts`](../src/utils/constants.ts)                                                                                             |
| REST controllers and request shapes                                                                      | [`server/handlers/`](../src/server/handlers/), [`server/handlers/rtos/`](../src/server/handlers/rtos/)                                        |

### Authorization

Described in [Authorization](./authorization.md).

| Concern                       | Source                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default permission resolution | [`utils/rbac.ts`](../src/utils/rbac.ts)                                                                                                                                                                                    |
| Default grant evaluation      | [`utils/grant-access.ts`](../src/utils/grant-access.ts)                                                                                                                                                                    |
| Roles, permissions, grants    | [`RolesService`](../src/server/interactors/roles.interactor.ts), [`PermissionsService`](../src/server/interactors/permissions.interactor.ts), [`GrantAccessService`](../src/server/interactors/grant-access.interactor.ts) |
| Schemas and tenant scoping    | [`repositories/roles/model.defs.ts`](../src/server/repositories/roles/model.defs.ts), [`repositories/grant-access/model.defs.ts`](../src/server/repositories/grant-access/model.defs.ts)                                   |
| Behaviors and configs         | [`server/apps/auth.app.ts`](../src/server/apps/auth.app.ts), [`server/apps/grant-access.app.ts`](../src/server/apps/grant-access.app.ts)                                                                                   |

### Users

| Concern                                                        | Source                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Profiles, registration, self-service deactivation and deletion | [`UsersService`](../src/server/interactors/users.interactor.ts)                                                 |
| Why profiles and sign-in records are separate collections      | [`repositories/users/model.defs.ts`](../src/server/repositories/users/model.defs.ts)                            |
| Status checks on every sign-in and refresh                     | [`repositories/users/entity.provider.ts`](../src/server/repositories/users/entity.provider.ts) (`assertActive`) |

### Hosted frontend (`@zanix/space`)

| Concern                                    | Source                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Pages and how they set session cookies     | [`space/routes/[lang]/`](../src/space/routes/[lang]/) (see [`login/page.tsx`](../src/space/routes/[lang]/login/page.tsx)) |
| Language routing and cookie-consent bypass | [`space/middleware.ts`](../src/space/middleware.ts)                                                                       |
| Session-cookie presence check              | [`space/session-cookie.ts`](../src/space/session-cookie.ts)                                                               |
| Cookie-consent dialog                      | [`space/comets/cookie-consent-modal.comet.tsx`](../src/space/comets/cookie-consent-modal.comet.tsx)                       |

### Notification templates

| Concern                                   | Source                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `/api/templates` controller and its guard | [`server/handlers/templates.handler.ts`](../src/server/handlers/templates.handler.ts) |
| `totp-enabled` template seeding           | [`server/apps/auth.app.ts`](../src/server/apps/auth.app.ts) (`setup`)                 |
| Discovery (`codeTemplatesDiscovery`)      | [`mod.ts`](../mod.ts)                                                                 |

### See also

- [Authentication flows](./authentication-flows.md)
- [Authorization](./authorization.md)
- [REST API reference](./rest-api.md)
- [Configuration](./configuration.md)
- [README](../README.md)
