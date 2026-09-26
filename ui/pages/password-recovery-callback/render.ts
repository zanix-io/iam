import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { RecoveryCallbackViewProps } from './types.ts'

const EMAIL_FIELD_ID = 'recovery-email'
const CODE_FIELD_ID = 'recovery-code'
const PASSWORD_FIELD_ID = 'recovery-password'
const CONFIRM_PASSWORD_FIELD_ID = 'recovery-confirm-password'

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
  PasswordToggleField: (
    props: Record<string, unknown> & { showLabel: string; hideLabel: string },
  ) => E
  ManagedForm: (
    props: {
      formId: string
      draft?: { storageKey: string; hasServerValues: boolean; excludeFields?: string[] }
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
  const { useIntl, Button, Field, Input, PasswordToggleField, ManagedForm } = deps

  return function RecoveryCallbackView(
    {
      csrfToken,
      fieldErrors,
      submitted,
      invalidCode,
      mismatch,
      weakPassword,
      email,
      emailLocked,
      nonce,
    }: RecoveryCallbackViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('password/recovery/callback-heading')),
      // Only when `email` is actually known (pre-filled via `?email=` — a caller reaching this
      // step with no email at all, e.g. someone who already has a code from a channel other than
      // the plain link, has nothing definite to confirm here). A real code was already dispatched
      // by the time this step renders regardless of which prior step sent the caller here — no
      // account-existence ambiguity to hedge at this point, unlike the REQUEST step's own
      // `request-body` (which still must, since an anonymous visitor could type any email there).
      email ? h('p', null, formatMessage('password/recovery/callback-subtext', { email })) : null,
      // The `data-space='banner'`/`data-variant` pair is the hook the default stylesheet
      // (`ui/styles.ts`) and an app's own CSS style; see `login/render.ts`.
      invalidCode
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('common/invalid-or-expired-code'),
        )
        : null,
      // Checked entirely by the owning page's own `action` (never sent to `iam`'s real endpoint,
      // which only ever receives one `password` value) — see `RecoveryCallbackViewProps.mismatch`'s
      // own doc.
      mismatch
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('password/recovery/mismatch'),
        )
        : null,
      weakPassword
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('password/recovery/weak-password'),
        )
        : null,
      h(ManagedForm, {
        formId: FORM_ID,
        draft: {
          storageKey: DRAFT_STORAGE_KEY,
          hasServerValues: submitted !== undefined,
          // A locked email is never this primitive's to read OR write: restoring a stale draft
          // value (even a blank one, from an earlier anonymous visit to this SAME storage key)
          // would silently override the session's own known, correct address underneath a field
          // the visitor can't retype.
          excludeFields: emailLocked ? ['email'] : undefined,
        },
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
                // See `RecoveryCallbackViewProps.emailLocked`'s own doc — `readOnly`, never
                // `disabled`: a `disabled` field is excluded from the submitted `FormData`
                // entirely, which would drop `email` from the body this form's own `action` needs.
                readOnly: emailLocked,
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
              h(PasswordToggleField, {
                ...fieldProps,
                name: 'password',
                autoComplete: 'new-password',
                required: true,
                showLabel: formatMessage('password/recovery/password-show'),
                hideLabel: formatMessage('password/recovery/password-hide'),
                nonce,
              }),
          },
        ),
        h(
          Field,
          {
            id: CONFIRM_PASSWORD_FIELD_ID,
            label: formatMessage('password/recovery/confirm-label'),
            error: fieldMessage('confirmPassword', fieldErrors),
            children: (fieldProps: Record<string, unknown>) =>
              h(PasswordToggleField, {
                ...fieldProps,
                name: 'confirmPassword',
                autoComplete: 'new-password',
                required: true,
                showLabel: formatMessage('password/recovery/password-show'),
                hideLabel: formatMessage('password/recovery/password-hide'),
                nonce,
              }),
          },
        ),
        h(Button, { type: 'submit' }, formatMessage('password/recovery/submit')),
      ),
    )
  }
}
