import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { LoginViewProps } from 'ui/pages/login/types.ts'
import type {
  LoginPasswordStepLabels,
  LoginPasswordStepProps,
} from 'ui/components/login-password-step/types.ts'
import type { LoginTwoStepProps } from 'ui/components/login-two-step/types.ts'
import type { LoginEntryViewProps } from './types.ts'

/** The pieces this view composes, injected alongside `h` so one factory serves both renderers. */
export type LoginEntryViewDeps<E> = {
  useIntl: () => Formatter
  LoginView: (props: LoginViewProps) => E
  LoginPasswordStep: (props: LoginPasswordStepProps) => E
  LoginTwoStep: (props: LoginTwoStepProps & { comet?: 'load' }) => E
}

/**
 * The two-step sign-in screen: an email step (`LoginView`), the password step for an account that
 * has one, and the Comet that swaps the first for the second without a reload. The host provides
 * the `IntlProvider` (its own messages and languages), the frame (`Card`) and the page's `loader`
 * and `action` (`loginEntryPageData`, `handleLoginEntryAction`).
 *
 * Copy comes from the host's catalog, under the keys `LoginView` already reads plus these for the
 * password step: `login/password-step/heading`, `signing-in-as`, `invalid-password`,
 * `rate-limited`, `rate-limited/heading`, `rate-limited/body`, `forgot-password`,
 * `use-another-email`, and the shared `login/unexpected-error`, `login/password-label`,
 * `login/password-show`, `login/password-hide` and `login/submit`.
 */
export function createLoginEntryView<E>(
  h: CreateElement<E>,
  { useIntl, LoginView, LoginPasswordStep, LoginTwoStep }: LoginEntryViewDeps<E>,
): (props: LoginEntryViewProps<E>) => E {
  return function LoginEntryView(
    {
      Card,
      headingClassName,
      recoveryAction,
      passwordStep,
      stepEmail,
      invalidPassword,
      ...viewProps
    }: LoginEntryViewProps<E>,
  ): E {
    const { formatMessage } = useIntl()
    const lang = viewProps.lang

    const labels: LoginPasswordStepLabels = {
      heading: formatMessage('login/password-step/heading'),
      signingInAs: formatMessage('login/password-step/signing-in-as'),
      invalidPassword: formatMessage('login/password-step/invalid-password'),
      rateLimited: formatMessage('login/password-step/rate-limited'),
      rateLimitedHeading: formatMessage('login/password-step/rate-limited/heading'),
      rateLimitedBody: formatMessage('login/password-step/rate-limited/body'),
      unexpectedError: formatMessage('login/unexpected-error'),
      passwordLabel: formatMessage('login/password-label'),
      showPassword: formatMessage('login/password-show'),
      hidePassword: formatMessage('login/password-hide'),
      submit: formatMessage('login/submit'),
      // Without a recovery action the button has nowhere to post, so its label is left out too.
      forgotPassword: recoveryAction === false
        ? undefined
        : formatMessage('login/password-step/forgot-password'),
      useAnotherEmail: formatMessage('login/password-step/use-another-email'),
    }

    return h(
      // The frame is a component of the host's own; a plain element when it gives none.
      (Card ?? 'div') as never,
      null,
      h(
        'div',
        { 'data-login-step': 'email', hidden: passwordStep },
        h(LoginView, { ...viewProps, lang }),
      ),
      h(LoginPasswordStep, {
        lang,
        email: stepEmail,
        passwordStep,
        csrfToken: viewProps.csrfToken,
        invalidPassword,
        rateLimited: passwordStep && viewProps.rateLimited,
        unexpectedError: passwordStep && viewProps.unexpectedError,
        retryUntil: viewProps.retryUntil,
        clearQueryParamsOnRateLimitComplete: viewProps.clearQueryParamsOnRateLimitComplete,
        nonce: viewProps.nonce,
        labels,
        options: {
          headingClassName,
          ...(recoveryAction !== undefined ? { recoveryAction } : {}),
        },
      }),
      h(LoginTwoStep, { lang, csrfToken: viewProps.csrfToken, comet: 'load' }),
    )
  }
}
