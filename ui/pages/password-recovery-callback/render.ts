import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { RecoveryCallbackViewProps } from './types.ts'

const EMAIL_FIELD_ID = 'recovery-email'
const CODE_FIELD_ID = 'recovery-code'
const PASSWORD_FIELD_ID = 'recovery-password'

/** This page's own `<form>` id — `ManagedForm`'s own `formId` target. */
const FORM_ID = 'recovery-callback-form'

/** `FormDraftPersistence`'s own `storageKey` for this form — see `login/render.ts`'s own
 * identical doc for why this is a plain, `[lang]`-independent literal. Recovers a typed `email`/
 * `code` after an accidental refresh or navigate-away-and-back (this step can genuinely take a
 * while — an operator has to go check a separate inbox for the code); `password` is excluded
 * automatically. */
const DRAFT_STORAGE_KEY = 'password/recovery/callback'

/** The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — see
 * `login/render.ts`'s own doc for why these are all passed through `h` as component REFERENCES,
 * never called directly. */
export type RecoveryCallbackViewDeps<E> = {
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
  ManagedForm: (
    props: {
      formId: string
      draft?: { storageKey: string; hasServerValues: boolean }
      submitGuard?: boolean
    },
  ) => E | null
}

/** Extracts a single field's already-resolved error message(s) out of `PageFieldErrors` — same
 * shape/reasoning as `login/render.ts`'s own `fieldMessage`. */
function fieldMessage(
  property: string,
  fieldErrors: RecoveryCallbackViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s password-recovery CONFIRMATION view, shared identically
 * between the React and Preact bindings (`index.ts`/`index.preact.ts`). This file never imports
 * React, Preact, or `@zanix/space-ui` itself.
 */
export function createRecoveryCallbackView<E>(
  h: CreateElement<E>,
  deps: RecoveryCallbackViewDeps<E>,
): (props: RecoveryCallbackViewProps) => E {
  const { useIntl, Button, Field, Input, ManagedForm } = deps

  return function RecoveryCallbackView(
    { csrfToken, fieldErrors, submitted, invalidCode, email }: RecoveryCallbackViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('password/recovery/callback-heading')),
      invalidCode
        ? h('p', { role: 'alert' }, formatMessage('common/invalid-or-expired-code'))
        : null,
      h(ManagedForm, {
        formId: FORM_ID,
        draft: { storageKey: DRAFT_STORAGE_KEY, hasServerValues: submitted !== undefined },
        submitGuard: true,
      }),
      h(
        'form',
        { method: 'post', id: FORM_ID },
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h(
          Field,
          {
            id: EMAIL_FIELD_ID,
            label: formatMessage('login/email-label'),
            error: fieldMessage('email', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, {
                ...fieldProps,
                name: 'email',
                type: 'email',
                defaultValue: submitted?.email ?? email,
                required: true,
              }),
          },
        ),
        h(
          Field,
          {
            id: CODE_FIELD_ID,
            label: formatMessage('password/recovery/code-label'),
            error: fieldMessage('code', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, { ...fieldProps, name: 'code', type: 'text', required: true }),
          },
        ),
        h(
          Field,
          {
            id: PASSWORD_FIELD_ID,
            label: formatMessage('password/recovery/password-label'),
            error: fieldMessage('password', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, { ...fieldProps, name: 'password', type: 'password', required: true }),
          },
        ),
        h(Button, { type: 'submit' }, formatMessage('password/recovery/submit')),
      ),
    )
  }
}
