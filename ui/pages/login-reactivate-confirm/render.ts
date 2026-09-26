import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { ReactivateConfirmViewProps } from './types.ts'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target, same convention
 * `login-otp/render.ts`/`login-totp/render.ts` already establish. */
const FORM_ID = 'login-reactivate-form'

/** The `@zanix/space-ui` bindings/hook and Comet this view needs, injected alongside `h` — see
 * `login-totp/render.ts`'s own doc for why these are passed through `h` as component REFERENCES,
 * never called directly. */
export type ReactivateConfirmViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { type?: 'button' | 'submit' | 'reset'; disabled?: boolean }) => E
  SubmitGuard: (props: { formId: string }) => E | null
}

/**
 * The real implementation of `iam`'s reactivation-confirmation view — shared identically between
 * the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports React,
 * Preact, or `@zanix/space-ui` itself.
 *
 * Reached only after a real OTP/OAuth2 identity check already succeeded against an `'INACTIVE'`
 * account (see `AuthService.challengeReactivation`'s own doc, `server/interactors/auth.interactor.ts`)
 * — `iam` withheld session tokens on purpose instead of reactivating silently. This view's own
 * confirm submit is what actually reactivates the account (the owning page's `action` calls
 * `AuthService.confirmReactivation`); "Cancelar"/back-to-sign-in never does, so nothing changes if
 * the caller backs out.
 *
 * No `authHiddenFields` here (unlike `login-otp`/`login-totp`): that component's own `email` field
 * is mandatory (`AuthHiddenFieldsProps.email: string`) because `OtpLoginRTO`/`TotpLoginRTO` require
 * it in the body — this page's own `action` needs no body at all (only the CSRF token, already
 * carried by the URL's own `[token]` param), so a single hand-written `_csrf` input is the whole
 * form.
 */
export function createReactivateConfirmView<E>(
  h: CreateElement<E>,
  deps: ReactivateConfirmViewDeps<E>,
): (props: ReactivateConfirmViewProps) => E {
  const { useIntl, Button, SubmitGuard } = deps

  return function ReactivateConfirmView(
    { lang, csrfToken, expired }: ReactivateConfirmViewProps,
  ): E {
    const { formatMessage } = useIntl()

    if (expired) {
      return h(
        'main',
        null,
        h('h1', null, formatMessage('login/reactivate/heading')),
        h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('login/reactivate/expired'),
        ),
        h(
          'p',
          { 'data-space': 'auth-back-link' },
          h('a', { href: `/${lang}/login` }, formatMessage('common/back-to-sign-in')),
        ),
      )
    }

    return h(
      'main',
      null,
      h('h1', null, formatMessage('login/reactivate/heading')),
      h('p', null, formatMessage('login/reactivate/body')),
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h(Button, { type: 'submit' }, formatMessage('login/reactivate/confirm')),
      ),
      h(
        'p',
        { 'data-space': 'auth-back-link' },
        h('a', { href: `/${lang}/login` }, formatMessage('login/reactivate/cancel')),
      ),
    )
  }
}
