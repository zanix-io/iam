import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { AuthHiddenFieldsProps } from 'ui/components/auth-hidden-fields/types.ts'
import type { PhoneEnrollViewProps } from './types.ts'

const PHONE_FIELD_ID = 'phone-enroll-phone'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'phone-enroll-form'

/** The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — same
 * "component REFERENCES, never called directly" convention `login/render.ts`'s own doc
 * establishes. */
export type PhoneEnrollViewDeps<E> = {
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
   * component (same "call it, spread the result" convention `login-otp/render.ts` establishes).
   * Called here with no `email`/`phone` (there isn't one yet — the visitor is about to type it),
   * so it renders just the bare `_csrf` field. */
  authHiddenFields: (props: AuthHiddenFieldsProps) => E[]
}

/** Extracts a single field's already-resolved error message(s) out of the loader's own
 * `fieldErrors` — same shape/reasoning as `login/render.ts`'s own `fieldMessage`. */
function fieldMessage(
  property: string,
  fieldErrors: PhoneEnrollViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s phone-verification ENROLLMENT view — a single phone-number
 * field, submitting to this same page's own `action`, which dispatches the SMS code and redirects
 * to `../confirm`. Shared identically between the React and Preact bindings
 * (`index.ts`/`index.preact.ts`). This file never imports React, Preact, or `@zanix/space-ui`
 * itself.
 *
 * No draft persistence (`SubmitGuard`, not `ManagedForm`) — same reasoning `totp-enroll/render.ts`
 * gives: this form fires exactly once per real enrollment attempt, nothing here benefits from
 * surviving a reload.
 */
export function createPhoneEnrollView<E>(
  h: CreateElement<E>,
  deps: PhoneEnrollViewDeps<E>,
): (props: PhoneEnrollViewProps) => E {
  const { useIntl, Button, Field, Input, SubmitGuard, authHiddenFields } = deps

  return function PhoneEnrollView(
    { csrfToken, invalidCode, fieldErrors }: PhoneEnrollViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('phone/enroll/heading')),
      h('p', null, formatMessage('phone/enroll/body')),
      // The `data-space='banner'`/`data-variant` pair is the hook the default stylesheet
      // (`ui/styles.ts`) and an app's own CSS style; see `login/render.ts`.
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
        ...authHiddenFields({ csrfToken }),
        h(
          Field,
          {
            id: PHONE_FIELD_ID,
            label: formatMessage('phone/enroll/phone-label'),
            error: fieldMessage('phone', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, {
                ...fieldProps,
                name: 'phone',
                type: 'tel',
                placeholder: formatMessage('phone/enroll/phone-placeholder'),
                required: true,
              }),
          },
        ),
        h(Button, { type: 'submit' }, formatMessage('phone/enroll/submit')),
      ),
    )
  }
}
