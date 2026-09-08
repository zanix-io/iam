import type { PageActionContext, PageContext } from '@zanix/space'

import { Guard } from '@zanix/server'
import { csrfGuard, Page, SpacePageController } from '@zanix/space'
import { HttpError } from '@zanix/errors'
import { Button, Field, Input } from '@zanix/space-ui'
// See `../../../login/page.tsx`'s own identical doc for why this is a NAMED import, and why this
// project reaches for `ManagedForm` (draft + submitGuard, never `unsavedChanges`) here too.
import { ManagedForm } from '@zanix/space/comet/react'
import { PasswordService } from '../../../../../../server/interactors/password.interactor.ts'
import { PwdRecoveryCbRTO } from '../../../../../../server/handlers/rtos/password.ts'
import { redirectResponse } from '../../../../../../shared/redirect-response.ts'

type CallbackParams = { lang: string }

/** Query param this page's own `action` redirects back with on a rejected code. */
const INVALID_CODE_ERROR = 'invalid_code'

const EMAIL_FIELD_ID = 'recovery-email'
const CODE_FIELD_ID = 'recovery-code'
const PASSWORD_FIELD_ID = 'recovery-password'

/** This page's own `<form>` id — `ManagedForm`'s own `formId` target. */
const FORM_ID = 'recovery-callback-form'

/** `FormDraftPersistence`'s own `storageKey` for this form — see `../../../login/page.tsx`'s own
 * identical doc for why this is a plain, `[lang]`-independent literal. Recovers a typed `email`/
 * `code` after an accidental refresh or navigate-away-and-back (this step can genuinely take a
 * while — an operator has to go check a separate inbox for the code); `password` is excluded
 * automatically. */
const DRAFT_STORAGE_KEY = 'password/recovery/callback'

type CallbackViewProps = {
  csrfToken?: string
  fieldErrors?: Record<string, unknown>
  submitted?: Record<string, string>
  invalidCode: boolean
  /** Pre-fills the email field when reached via `../[email]/page.tsx`'s own `?email=` link —
   * still a plain, editable text input, since a code can arrive out of band (e.g. a bookmarked
   * link, or a code copied from an email opened on another device). */
  email: string
}

function fieldMessage(
  property: string,
  fieldErrors: CallbackViewProps['fieldErrors'],
): string[] | undefined {
  const entries = fieldErrors?.[property] as { constraints?: string[] }[] | undefined
  const messages = entries?.flatMap((entry) => entry.constraints ?? [])
  return messages?.length ? messages : undefined
}

function RecoveryCallbackView(
  { csrfToken, fieldErrors, submitted, invalidCode, email }: CallbackViewProps,
) {
  return (
    <main>
      <h1>Reset your password</h1>
      {invalidCode && <p role='alert'>Invalid or expired code.</p>}
      <ManagedForm
        formId={FORM_ID}
        draft={{ storageKey: DRAFT_STORAGE_KEY, hasServerValues: submitted !== undefined }}
        submitGuard
      />
      <form method='post' id={FORM_ID}>
        <input type='hidden' name='_csrf' value={csrfToken ?? ''} />
        <Field id={EMAIL_FIELD_ID} label='Email' error={fieldMessage('email', fieldErrors)}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name='email'
              type='email'
              defaultValue={submitted?.email ?? email}
              required
            />
          )}
        </Field>
        <Field id={CODE_FIELD_ID} label='Recovery code' error={fieldMessage('code', fieldErrors)}>
          {(fieldProps) => <Input {...fieldProps} name='code' type='text' required />}
        </Field>
        <Field
          id={PASSWORD_FIELD_ID}
          label='New password'
          error={fieldMessage('password', fieldErrors)}
        >
          {(fieldProps) => <Input {...fieldProps} name='password' type='password' required />}
        </Field>
        <Button type='submit'>Reset password</Button>
      </form>
    </main>
  )
}

/**
 * The password-recovery CONFIRMATION step — verifies the code `../[email]/page.tsx` dispatched and
 * sets a new password, issuing session tokens on success (`PasswordService.recoveryCallback`, the
 * same interactor method `PasswordController.recoveryCallback`, the REST endpoint, calls). No
 * `[email]` route segment of its own, unlike the request step: `PwdRecoveryCbRTO` already carries
 * `email` as a real, validated form field (pre-filled from `../[email]/page.tsx`'s own `?email=`
 * link when present), so a second dynamic segment would only duplicate it.
 */
@Page({ Interactor: PasswordService, action: { Body: PwdRecoveryCbRTO } })
@Guard(csrfGuard())
export default class PasswordRecoveryCallbackPage
  extends SpacePageController<CallbackParams, PasswordService> {
  public static override head = { title: 'Reset your password' }

  public override component = RecoveryCallbackView

  public override loader = (ctx: PageContext<CallbackParams>): CallbackViewProps => ({
    csrfToken: ctx.csrfToken,
    fieldErrors: ctx.fieldErrors,
    submitted: ctx.submitted,
    invalidCode: ctx.url.searchParams.get('error') === INVALID_CODE_ERROR,
    email: ctx.url.searchParams.get('email') ?? '',
  })

  public override action = async (ctx: PageActionContext<CallbackParams>): Promise<Response> => {
    const body = ctx.body as PwdRecoveryCbRTO
    const { lang } = ctx.params

    try {
      await this.interactor.recoveryCallback(body.email, body.code, body.password)
    } catch (e) {
      if (e instanceof HttpError && e.status.code === 'FORBIDDEN') {
        return redirectResponse(`/${lang}/password/recovery/callback?error=${INVALID_CODE_ERROR}`)
      }
      throw e
    }

    return redirectResponse('/')
  }
}
