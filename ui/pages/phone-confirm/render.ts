import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { PhoneConfirmViewProps } from './types.ts'

const CODE_FIELD_ID = 'phone-confirm-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'phone-confirm-form'

/** The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — same
 * "component REFERENCES, never called directly" convention `login/render.ts`'s own doc
 * establishes. */
export type PhoneConfirmViewDeps<E> = {
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

/** Extracts a single field's already-resolved error message(s) — same shape/reasoning as
 * `login-otp/render.ts`'s own `fieldMessage`. */
function fieldMessage(
  property: string,
  fieldErrors: PhoneConfirmViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s phone-verification CONFIRMATION view — a single code field,
 * plus the `phone` hidden field `../enroll` already dispatched a code to (`AuthService.phoneConfirm`
 * verifies against that SAME number, not merely whatever the client claims). Shared identically
 * between the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports
 * React, Preact, or `@zanix/space-ui` itself.
 *
 * No draft persistence (`SubmitGuard`, not `ManagedForm`) — same single-use-code reasoning as
 * `login-otp/render.ts`.
 */
export function createPhoneConfirmView<E>(
  h: CreateElement<E>,
  deps: PhoneConfirmViewDeps<E>,
): (props: PhoneConfirmViewProps) => E {
  const { useIntl, Button, Field, Input, SubmitGuard } = deps

  return function PhoneConfirmView(
    { phone, csrfToken, fieldErrors, invalidCode }: PhoneConfirmViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('phone/confirm/heading')),
      h('p', null, formatMessage('phone/confirm/sent-to', { phone })),
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
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h('input', { type: 'hidden', name: 'phone', value: phone }),
        h(
          Field,
          {
            id: CODE_FIELD_ID,
            label: formatMessage('phone/confirm/code-label'),
            error: fieldMessage('code', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, { ...fieldProps, name: 'code', type: 'text', required: true }),
          },
        ),
        h(Button, { type: 'submit' }, formatMessage('common/verify')),
      ),
    )
  }
}
