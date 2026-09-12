import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { OtpViewProps } from './types.ts'

const CODE_FIELD_ID = 'otp-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'login-otp-form'

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
  const { useIntl, Button, Field, Input, SubmitGuard } = deps

  return function OtpView(
    { lang, email, csrfToken, fieldErrors, invalidCode }: OtpViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('login/otp/heading')),
      h('p', null, formatMessage('login/otp/sent-to', { email })),
      invalidCode
        ? h('p', { role: 'alert' }, formatMessage('common/invalid-or-expired-code'))
        : null,
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h('input', { type: 'hidden', name: 'email', value: email }),
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
      h(
        'p',
        null,
        h('a', { href: `/${lang}/login` }, formatMessage('common/back-to-sign-in')),
      ),
    )
  }
}
