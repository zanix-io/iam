import type { CreateElement } from 'ui/typings/renderer.ts'
import type { AuthHiddenFieldsProps } from 'ui/components/auth-hidden-fields/types.ts'
import type { RateLimitCardProps } from 'ui/components/rate-limit-card/types.ts'
import type { LoginPasswordStepProps } from './types.ts'

/** The ring of the rate-limit card: the size and stroke every rate-limit card of the login screens
 * uses, so they all look alike. */
const RATE_LIMIT_RING_SIZE = 72
const RATE_LIMIT_RING_STROKE = 5

/** The `@zanix/space-ui` bindings and sibling components this step composes, injected alongside
 * `h` so one render factory serves both renderers. */
export type LoginPasswordStepDeps<E> = {
  Button: (
    props: {
      type?: 'button' | 'submit' | 'reset'
      disabled?: boolean
      className?: string
      children?: unknown
    },
  ) => E
  Field: (
    props: {
      id: string
      label: string
      error?: string | string[]
      children: (fieldProps: Record<string, unknown>) => E
    },
  ) => E
  Link: (props: { href: string; children?: unknown }) => E
  PasswordToggleField: (
    props: Record<string, unknown> & { showLabel: string; hideLabel: string },
  ) => E
  RateLimitCard: (props: RateLimitCardProps) => E
  authHiddenFields: (props: AuthHiddenFieldsProps) => E[]
}

/**
 * The password step of a two-step sign-in — the field shown once the email is known to belong to an
 * account with a password. It renders inside the page's own layout, next to the email step
 * (`data-login-step='email'`), and a comet (`LoginTwoStep`) toggles between the two through the
 * `data-login-step` / `data-login-email-display` hooks below, so renaming either breaks it.
 *
 * All copy arrives as plain strings and all styling as options: the step carries no message key, no
 * brand class and no route of its own.
 */
export function createLoginPasswordStep<E>(
  h: CreateElement<E>,
  {
    Button,
    Field,
    Link,
    PasswordToggleField,
    RateLimitCard,
    authHiddenFields,
  }: LoginPasswordStepDeps<E>,
): (props: LoginPasswordStepProps) => E {
  return function LoginPasswordStep(
    {
      lang,
      email,
      passwordStep,
      csrfToken,
      invalidPassword,
      rateLimited,
      unexpectedError,
      retryUntil,
      clearQueryParamsOnRateLimitComplete,
      nonce,
      labels,
      options = {},
    }: LoginPasswordStepProps,
  ): E {
    const formId = options.formId ?? 'login-password-form'
    const cardDataSpace = options.cardDataSpace ?? 'login-password-rate-limit'

    const liveRetryUntil = retryUntil !== undefined && retryUntil > Date.now()
      ? retryUntil
      : undefined
    const showRateLimitCountdown = rateLimited && liveRetryUntil !== undefined

    return h(
      'div',
      { 'data-login-step': 'password', hidden: !passwordStep },
      h('h1', options.headingClassName ? { class: options.headingClassName } : {}, labels.heading),
      // A plain DOM node: the comet writes the email into it directly, which a formatted sentence
      // could not offer it.
      h(
        'p',
        { 'data-space': 'auth-description' },
        labels.signingInAs,
        ' ',
        h('strong', { 'data-login-email-display': true }, email),
      ),
      invalidPassword &&
        h(
          'div',
          { 'data-space': 'banner', 'data-variant': 'error', role: 'alert' },
          labels.invalidPassword,
        ),
      rateLimited && !showRateLimitCountdown &&
        h(
          'div',
          { 'data-space': 'banner', 'data-variant': 'error', role: 'alert' },
          labels.rateLimited,
        ),
      showRateLimitCountdown &&
        h(RateLimitCard, {
          target: liveRetryUntil as number,
          size: RATE_LIMIT_RING_SIZE,
          strokeWidth: RATE_LIMIT_RING_STROKE,
          nonce,
          formId,
          cardDataSpace,
          clearQueryParamsOnComplete: clearQueryParamsOnRateLimitComplete,
          headingLabel: labels.rateLimitedHeading,
          bodyLabel: labels.rateLimitedBody,
        }),
      unexpectedError &&
        h(
          'div',
          { 'data-space': 'banner', 'data-variant': 'error', role: 'alert' },
          labels.unexpectedError,
        ),
      h(
        'form',
        { id: formId, method: 'post' },
        ...authHiddenFields({ csrfToken, email }),
        h(
          Field,
          { id: 'login-password', label: labels.passwordLabel },
          (fieldProps: Record<string, unknown>) =>
            h(PasswordToggleField, {
              ...fieldProps,
              name: 'password',
              autoComplete: 'current-password',
              required: true,
              disabled: showRateLimitCountdown,
              showLabel: labels.showPassword,
              hideLabel: labels.hidePassword,
              nonce,
              comet: 'load',
            }),
        ),
        h(
          Button,
          {
            type: 'submit',
            className: options.submitClassName ?? 'btn btn-primary btn-block',
            disabled: showRateLimitCountdown,
          },
          labels.submit,
        ),
      ),
      h(
        'div',
        { 'data-space': 'auth-actions' },
        options.recoveryAction !== false && labels.forgotPassword !== undefined &&
          h(
            'form',
            {
              method: 'post',
              action: options.recoveryAction ?? `/${lang}/login/password/recovery`,
            },
            ...authHiddenFields({ csrfToken, email }),
            h(
              Button,
              { type: 'submit', className: options.linkButtonClassName ?? 'btn-text' },
              labels.forgotPassword,
            ),
          ),
        h(Link, { href: options.loginHref ?? `/${lang}/login` }, labels.useAnotherEmail),
      ),
    )
  }
}
