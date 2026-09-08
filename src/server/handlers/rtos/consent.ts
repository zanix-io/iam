import { BaseRTO, IsBoolean } from '@zanix/validator'

/** `POST /{lang}/consent` body — the operator's real cookie-consent decision (Accept or Decline),
 * always sent explicitly (see `../../../space/routes/[lang]/consent/page.tsx`'s own doc for why
 * `false` is a real, persisted value here too, not just the absence of `true`). */
export class ConsentRTO extends BaseRTO {
  @IsBoolean({ expose: true })
  accessor accepted!: boolean
}
