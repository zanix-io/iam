import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { AuthHiddenFieldsProps } from 'ui/components/auth-hidden-fields/types.ts'
import type { OtpNotifierChannel, OtpResendProps } from 'ui/components/otp-resend/types.ts'
import type { OtpViewProps } from './types.ts'
import { buildOtpNotifierOptions } from '../../sdk/otp-channel.ts'

const CODE_FIELD_ID = 'otp-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'login-otp-form'

/** Already-resolved-copy message keys per {@linkcode OtpNotifierChannel} — `formatMessage`'s own
 * keys for `OtpResend`'s own `notifierOptions[].label`. Short, standalone channel names (e.g.
 * "SMS"), meant to sit inside that component's own `<select>` — `login/otp/resend-notifier-label`
 * (the picker's own accessible label) already supplies the "pick a channel" context, so these
 * never repeat it. */
const NOTIFIER_LABEL_KEYS: Record<OtpNotifierChannel, string> = {
  email: 'login/otp/notifier-email',
  sms: 'login/otp/notifier-sms',
  whatsapp: 'login/otp/notifier-whatsapp',
}

/** Builds `OtpResend`'s own `notifierOptions` — every channel actually deliverable for this
 * account (the one that JUST dispatched this screen's own code INCLUDED), filtered to what's
 * real (`'email'` always is; `'sms'`/`'whatsapp'` only with a verified phone on file). A single
 * entry (no verified phone at all — the common case) means `OtpResend` renders no picker at all,
 * same as an empty array. */
function buildNotifierOptions(
  formatMessage: Formatter['formatMessage'],
  hasVerifiedPhone: OtpViewProps['hasVerifiedPhone'],
): OtpResendProps['notifierOptions'] {
  return buildOtpNotifierOptions(formatMessage, hasVerifiedPhone, NOTIFIER_LABEL_KEYS)
}

/**
 * The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — see
 * `login/render.ts`'s own doc for why `Button`/`Field`/`Input`/`SubmitGuard` are all passed
 * through `h` as component REFERENCES, never called directly.
 */
export type OtpViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { type?: 'button' | 'submit' | 'reset' }) => E
  Field: (
    props: {
      id: string
      label: string
      error?: string | string[]
      children: (fieldProps: Record<string, unknown>) => E
    },
  ) => E
  Input: (props: Record<string, unknown>) => E
  SubmitGuard: (props: { formId: string }) => E | null
  /** `ui/components/auth-hidden-fields`'s own bound `authHiddenFields` — a plain function, never a
   * component reference (see that component's own doc for why it returns `E[]`, not `E`, and is
   * spread into `<form>`'s children rather than passed through `h`). */
  authHiddenFields: (props: AuthHiddenFieldsProps) => E[]
  /** The already-`defineComet`-wrapped `OtpResend` (`ui/components/otp-resend`, its DEFAULT
   * export — the real hydration boundary), the same "compose the raw Comet default export as a
   * child" idiom `RateLimitCard/render.ts`'s own doc establishes for `RateLimitCountdown` — this
   * view's resend/channel-picker affordance. */
  OtpResend: (props: Record<string, unknown>) => E | null
}

/** Extracts a single field's already-resolved error message(s) out of `PageFieldErrors` — same
 * shape/reasoning as `login/render.ts`'s own `fieldMessage`. */
function fieldMessage(
  property: string,
  fieldErrors: OtpViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s OTP (email/SMS/WhatsApp) second-factor challenge view,
 * shared identically between the React and Preact bindings (`index.ts`/`index.preact.ts`). This
 * file never imports React, Preact, or `@zanix/space-ui` itself.
 *
 * No draft persistence (`SubmitGuard`, not `ManagedForm`) — an OTP code is a short-lived,
 * single-use value; restoring a stale one after it expires would be actively unhelpful, not a
 * convenience. See the owning page's own doc.
 */
export function createOtpView<E>(
  h: CreateElement<E>,
  deps: OtpViewDeps<E>,
): (props: OtpViewProps) => E {
  const { useIntl, Button, Field, Input, SubmitGuard, authHiddenFields, OtpResend } = deps

  return function OtpView(
    {
      lang,
      email,
      csrfToken,
      fieldErrors,
      invalidCode,
      cooldownEndsAt,
      nonce,
      otpNotifier,
      hasVerifiedPhone,
    }: OtpViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('login/otp/heading')),
      h('p', null, formatMessage('login/otp/sent-to', { email, channel: otpNotifier ?? 'email' })),
      // The `data-space='banner'`/`data-variant` pair is the hook the default stylesheet and an
      // app's own CSS style; see `login/render.ts`.
      invalidCode
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('common/invalid-or-expired-code'),
        )
        : null,
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        ...authHiddenFields({ csrfToken, email }),
        h(
          Field,
          {
            id: CODE_FIELD_ID,
            label: formatMessage('login/otp/code-label'),
            error: fieldMessage('code', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, { ...fieldProps, name: 'code', type: 'text', required: true }),
          },
        ),
        h(Button, { type: 'submit' }, formatMessage('common/verify')),
      ),
      h(OtpResend, {
        lang,
        email,
        csrfToken,
        cooldownEndsAt,
        nonce,
        resendLabel: formatMessage('login/otp/resend'),
        cooldownLabel: formatMessage('login/otp/resend-cooldown'),
        notifierOptions: buildNotifierOptions(formatMessage, hasVerifiedPhone),
        currentNotifier: otpNotifier ?? 'email',
        notifierPickerLabel: formatMessage('login/otp/resend-notifier-label'),
      }),
      h(
        'p',
        { 'data-space': 'auth-back-link' },
        h('a', { href: `/${lang}/login` }, formatMessage('common/back-to-sign-in')),
      ),
    )
  }
}
