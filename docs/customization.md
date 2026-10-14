## Customization

How to change what `iam`'s screens say, how they look, and how its logic decides, without forking
it. Each lever applies to the hosted pages and to an app that renders `iam`'s views itself.

### Contents

- [Messages](#messages)
- [Account-security emails](#account-security-emails)
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

**Step-up code message.** The one-time code of a [step-up](./authentication-flows.md#step-up) is
worded on the server from its own catalog (`STEP_UP_MESSAGES`, English and Spanish, no product
named), not from the screens' catalogs. The same `IAM_MESSAGES` object is merged over it, key by
key, on every send. The keys, with the placeholders each fills:

| Key                             | Used in          | Default (`en`)                                                                                                                                   | Placeholders                       |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `step-up.subject`               | email subject    | `Confirm an action`                                                                                                                              |                                    |
| `step-up.title`                 | email heading    | `Confirm an action`                                                                                                                              |                                    |
| `step-up.intro`                 | email            | `Use this code to confirm that you want to {purpose}.`                                                                                           | `{purpose}`                        |
| `step-up.validity`              | email            | `The code is valid for {minutes} minutes.`                                                                                                       | `{minutes}`                        |
| `step-up.footer`                | email            | `If you did not request this code, you can ignore this message.`                                                                                 |                                    |
| `step-up.text`                  | SMS and WhatsApp | `{code} is your code to confirm that you want to {purpose}. It is valid for {minutes} minutes.`                                                  | `{code}`, `{purpose}`, `{minutes}` |
| `step-up.purpose.default`       | `{purpose}`      | `carry out an action on your account`                                                                                                            |                                    |
| `step-up.purpose.factor-change` | `{purpose}`      | `change your verification method` (`cambiar tu método de verificación`): the purpose `iam` itself uses to change a second factor or a credential |                                    |
| `step-up.purpose.<purpose>`     | `{purpose}`      | none: a purpose without its key takes `step-up.purpose.default`                                                                                  |                                    |

`<purpose>` is the `purpose` of `POST /api/step-up/request` (lowercase letters, digits and hyphens).

In the email, the code is the template's `buttonText` (no `buttonLink`), `step-up.validity` is its
`message` and `step-up.intro` its `content`: the fields the login and recovery code emails use, so a
`generic` template that styles the one-time code styles this one too.

The purpose only selects the key; it is never placed in the message, so a client cannot write text
into it. The phrase completes the sentence ("confirm that you want to ..."), and each message is a
whole sentence, so a language reorders the words in its own copy of the key. A key with a string
value applies to every language; a key whose value is an object holds the keys of one language, so
an app that serves several languages words each in its own. A regional tag (`es-MX`) reads its base
language block (`es`), and an exact block wins over it. In the email the values are HTML-escaped;
SMS and WhatsApp are plain text.

```sh
IAM_MESSAGES='{"en":{"step-up.purpose.confirm-transfer":"send a transfer from your balance"},"es":{"step-up.purpose.confirm-transfer":"enviar una transferencia de tu saldo"}}'
```

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

**Countdown announcements.** The screen-reader text of the countdowns in `RateLimitCountdown`
(`RateLimitCard`, `LoginPasswordStep`'s `labels`) and `OtpResend` is `Countdown`'s
(`@zanix/space-ui` 2.9.4 and later) and arrives as three optional string props, each falling back to
English when unset: `announcementDone`, `announcementLessThanMinute` and `announcementMinutes`. The
views fill them from `login/countdown/announcement-done`, `…-less-than-minute` and `…-minutes`
(`countdownAnnouncements`, exported from `@zanix/iam/ui/sdk/countdown-announcements`). The
`…-minutes` message keeps its `{minutes}` marker literal for `Countdown` to fill (the catalog writes
it as `'{minutes}'`, ICU's escape). An app that composes these Comets itself passes the three props
from its own catalog.

**Password heading.** The heading of `LoginView` in password mode is not a catalog key: it is the
`heading` prop, else the `iam` space app's `loginHeading` behavior (see [Behaviors](#behaviors)),
else `'Sign in'`. Passwordless mode reads `login/heading` from the catalog.

### Account-security emails

`iam` sends four account-security notices about the authenticator app. Each is a database-only
template that the `iam` app registers with `@zanix/notifications` (`registerTemplateSeeds`, channel
`email`) when `TEMPLATES_BACKEND=local`, with its words in English and Spanish in the message
catalog (`{{t 'key'}}`, the language of the request). They are added when missing, kept current
while nobody edits them, and an edit made through `/api/templates` is never overwritten. A product
brands them by registering a template with the same `{channel, name}` (or by editing the record).
With `TEMPLATES_BACKEND=remote` the central catalog must carry them; with the templates unset
nothing is sent.

| Template                 | Sent when                                            | `data`                                    | Catalog keys (`en` and `es`)                                                                                |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `totp-enabled`           | An account enables the authenticator app             | none                                      | `totp-enabled.subject`, `.title`, `.content`                                                                |
| `totp-disabled`          | An account turns it off                              | none                                      | `totp-disabled.subject`, `.title`, `.content`                                                               |
| `totp-backup-code-used`  | A backup code signs in or confirms a step-up         | `remaining`: the backup codes left (`0+`) | `totp-backup-code-used.subject`, `.title`, `.content` (uses `{remaining}`), `.content-none` (when `0` left) |
| `totp-reset-by-operator` | Support removes the authenticator app (`totp-reset`) | none                                      | `totp-reset-by-operator.subject`, `.title`, `.content`                                                      |

These keys belong to the templates catalog, not to `IAM_MESSAGES` (which words the hosted pages and
the step-up code message): `iam` adds no `IAM_MESSAGES` key for backup codes or the operator reset.
The recipient is the account's login email; the operator's reason is never put in an email.

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
