import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { TotpViewProps } from './types.ts'

const CODE_FIELD_ID = 'totp-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'login-totp-form'

/** The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — see
 * `login/render.ts`'s own doc for why these are all passed through `h` as component REFERENCES,
 * never called directly. */
export type TotpViewDeps<E> = {
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
  fieldErrors: TotpViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

/**
 * The real implementation of `iam`'s TOTP (authenticator-app) second-factor LOGIN challenge view
 * — distinct from `totp-confirm`/`totp-enroll` (this project's TOTP ENROLLMENT views) — shared
 * identically between the React and Preact bindings (`index.ts`/`index.preact.ts`). This file
 * never imports React, Preact, or `@zanix/space-ui` itself.
 *
 * No draft persistence (`SubmitGuard`, not `ManagedForm`) — same single-use-code reasoning as
 * `login-otp/render.ts`.
 */
export function createTotpLoginView<E>(
  h: CreateElement<E>,
  deps: TotpViewDeps<E>,
): (props: TotpViewProps) => E {
  const { useIntl, Button, Field, Input, SubmitGuard } = deps

  return function TotpLoginView(
    { lang, email, csrfToken, fieldErrors, invalidCode }: TotpViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('login/totp/heading')),
      h('p', null, formatMessage('login/totp/signing-in-as', { email })),
      invalidCode ? h('p', { role: 'alert' }, formatMessage('login/totp/invalid-code')) : null,
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
            label: formatMessage('login/totp/code-label'),
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
