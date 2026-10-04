## Customization

How to change what `iam`'s screens say, how they look, and how its logic decides, without forking
it. Each lever applies to the hosted pages and to an app that renders `iam`'s views itself.

### Contents

- [Messages](#messages)
- [Styles](#styles)
- [Behaviors](#behaviors)
- [See also](#see-also)

### Messages

`iam`'s views read their wording from message catalogs ([`ui/sdk/messages`](../ui/sdk/messages.ts))
that ship in `en` and `es`, worded without naming a product. Each level of consumption takes only
what it needs:

| Consumer                                         | Messages                                            |
| ------------------------------------------------ | --------------------------------------------------- |
| Hosted pages                                     | Already wired; override with `IAM_MESSAGES` (below) |
| An app rendering `iam`'s views in `@zanix/space` | `messageSources: [iamMessages]`                     |
| An app building its own UI on the headless SDK   | `IAM_UI_MESSAGES` (or `_EN`/`_ES`) as plain data    |
| A backend only                                   | Nothing                                             |

```ts
import { defineSpaceApp } from '@zanix/space'
import { iamMessages } from '@zanix/iam/ui/sdk/messages'
import { iamCssSource } from '@zanix/iam/ui/styles'

export default defineSpaceApp({
  name: 'storefront',
  messagesDir: './messages',
  messageSources: [iamMessages],
  cssSources: [iamCssSource],
  globalCss: ['./theme/app.css'],
})
```

**Your files win.** `@zanix/space` merges the app's `messagesDir` over the catalogs key by key, in
any file name, so an app rewords one message by defining that key in its own `messages/{lang}/`
folder.

**Hosted pages without a rebuild.** `IAM_MESSAGES` takes a JSON object of keys to strings, merged
over the catalog on every request, e.g. `IAM_MESSAGES='{"login/heading":"Sign in to Acme"}'`.
Malformed JSON fails the request (`IAM_INVALID_MESSAGES`).

**Precompiled.** `iamMessages` answers the catalogs already compiled to ICU AST, like the ones
`zanix space build` compiles from an app's own `messages/` folder, so nothing is parsed at run time.
The app's strings and `iam`'s AST mix freely, key by key. After editing a catalog in `iam`, run
`deno task gen:messages`; a test fails when the generated files are stale.

**Adding a language.** To offer another language, add `messages/pt/…json` with the keys of
`IAM_UI_MESSAGES_EN` to the app's own `messagesDir` and list `pt` in its `availableLangs`; `iam`
needs no change. `iamMessages('pt')` answers nothing, so exactly what the app defines is used: an
untranslated key renders as its id. A regional code (`es-MX`) falls back to `iam`'s `es` when the
app defines no catalog for it. The hosted pages serve only `en` (`AVAILABLE_LANGS` in
[`src/space/constants.ts`](../src/space/constants.ts)).

**The keys are an interface.** The catalog holds every key `iam`'s views and components read, and a
test keeps the two in step (a key read but undefined, or defined but never read, fails). Renaming a
key is a breaking change.

**Password heading.** The heading of `LoginView` in password mode is not a catalog key: it is the
`heading` prop, else the `iam` space app's `loginHeading` behavior (see [Behaviors](#behaviors)),
else `'Sign in'`. Passwordless mode reads `login/heading` from the catalog.

### Styles

`iam`'s markup carries `data-space` hooks and no design-system classes of its own. The default
stylesheet, [`ui/styles`](../ui/styles.ts) (`IAM_UI_CSS`, or `iamCssSource` for
`defineSpaceApp({ cssSources })`; the rules live in [`ui/styles.css`](../ui/styles.css)), styles
those hooks; the page or card wrapper, buttons (`.btn` classes) and fields belong to the host's
design system.

**Order and specificity.** The stylesheet is placed before the app's `globalCss`, and its selectors
are plain hook selectors (`[data-space='banner']`, or a hook and one control inside it). A rule of
the app's for the same hook with the same specificity, written after it, wins.

**Tokens.** The stylesheet reads `--space-*` design tokens with fallbacks, so redeclaring a few
tokens usually restyles it:

- colors: `--space-color-ink`, `--space-color-ink-muted`, `--space-color-border`,
  `--space-color-surface`, `--space-color-primary`, `--space-color-primary-strong`,
  `--space-color-danger`, `--space-color-warning`, `--space-color-info`, `--space-color-success`;
- spacing: `--space-space-xs`, `--space-space-sm`, `--space-space-md`, `--space-space-lg`;
- radius: `--space-radius-sm`, `--space-radius-md`, `--space-radius-pill`;
- motion: `--space-motion-fast`, `--space-ease-warm`.

On the hosted pages, set tokens without a rebuild with `IAM_THEME`, a JSON object applied through
`space.app.ts`'s `theme.resolve`, e.g. `IAM_THEME='{"--space-color-primary":"#16a34a"}'`. Malformed
JSON fails the request (`IAM_INVALID_THEME`).

**Hooks.** Every `data-space` value the views and components emit:

| Hook                                                                                        | Element                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `banner`                                                                                    | Error and status messages; `data-variant` is `error`, `warn`, `info` or `success` |
| `auth-description`, `auth-hint`                                                             | Supporting text in the password step and the resend component                     |
| `auth-actions`                                                                              | The row of form actions                                                           |
| `auth-back-link`                                                                            | "Back to sign in" and similar links                                               |
| `auth-divider`                                                                              | The "or" divider between OAuth2 buttons and the email form                        |
| `auth-oauth-buttons`, `auth-oauth-button` (`data-provider`)                                 | Passwordless mode's provider buttons                                              |
| `auth-oauth-link`                                                                           | Password mode's provider links                                                    |
| `auth-provider-icon`                                                                        | The inline provider mark inside a button                                          |
| `auth-legal-links`                                                                          | Terms and privacy links                                                           |
| `login-rate-limit-heading`, `login-rate-limit-body`                                         | The rate-limit card's text                                                        |
| `otp-code-field`, `otp-code-field-boxes`, `otp-code-field-box`, `otp-code-field-real-input` | The six-box code field (`data-active`, `data-error` on boxes)                     |
| `otp-resend-notifier-picker`                                                                | The delivery-channel picker of `OtpResend`                                        |
| `otpauth-link`                                                                              | The authenticator link on the TOTP enrollment page                                |
| `error`                                                                                     | The OAuth2 callback error boundary                                                |

The two-step sign-in also toggles `data-login-step` (`email`, `password`) and
`data-login-email-display`. `RateLimitCard` takes the hook of its wrapper as the `cardDataSpace`
prop, and the countdown it renders is `@zanix/space-ui`'s `[data-space-ui='countdown']`
(`data-variant='ring'`).

### Behaviors

Pure-function slots declared by `iam`'s App manifests, replaced by the host that composes them
without forking the code:

| App            | Behavior                      | Default                                                                                    | Used by                                                                                      |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `auth`         | `passwordPolicy`              | At least 8 characters, one uppercase letter, one digit; returns `true` or an error message | Password change, add and recovery (`400` with the message)                                   |
| `auth`         | `totpProvisioningLabel`       | The account email                                                                          | The account label in the authenticator app                                                   |
| `auth`         | `resolveEffectivePermissions` | A role's active permissions, as codes                                                      | The `aud` claim of every session; see [Authorization](./authorization.md#roles-and-sessions) |
| `grant-access` | `evaluateGrantAccess`         | `READ` < `WRITE` < `MANAGE`, else exact match                                              | `GET /api/grant-access/check` and the `checkAccess` operation                                |
| `iam` (space)  | `loginHeading`                | `'Sign in'`                                                                                | The heading of `LoginView` in password mode                                                  |

Override them in the `Zanix.start()` entry of the app:

```ts
import Zanix from '@zanix/core'
import authApp from '@zanix/iam/auth-app'

await Zanix.start({
  apps: {
    [authApp.definition.name]: {
      definition: authApp,
      behaviors: {
        passwordPolicy: (password: string) =>
          password.length >= 12 || 'Password must be at least 12 characters long.',
      },
    },
  },
})
```

`Zanix.start()` throws at boot for a behavior the manifest does not declare. Plain values (such as
self-registration) are runtime configs, not behaviors; see
[Configuration](./configuration.md#runtime-configs).

### See also

- [Configuration](./configuration.md)
- [Consuming iam](./consuming-iam.md)
- [API reference](./api-reference.md)
- [README](../README.md)
