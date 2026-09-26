import type { CreateElement } from 'ui/typings/renderer.ts'
import type { AuthHiddenFieldsProps } from './types.ts'

/**
 * The `_csrf` hidden `<input>` every form in this package (and its consumers) needs, plus ONE
 * optional subject field (`email` or `phone`) alongside it.
 *
 * ## Why this exists
 *
 * `login-otp/render.ts`'s own `OtpView` and `login-totp/render.ts`'s own `TotpView` compose this
 * for their `_csrf`+`email` pair. An app that hand-rolls its OWN markup around the exact same
 * `OtpLoginRTO`-backed `action` (a six-box code field and its own surrounding copy, not this
 * package's whole `OtpView`) composes it as well, because forgetting the `email` half fails
 * silently: `OtpLoginRTO`/`TotpLoginRTO` (`ui/sdk/otp.ts`/`ui/sdk/totp.ts`'s own REST callback body
 * schema, reused verbatim as the SSR page's own `@Page({ action: { Body } })` validation) requires
 * `email` in the body even though neither page's own `action` ever reads it — both derive `email`
 * from their own URL param instead — so without it the RTO's validation pipe rejects every
 * submission with a `422` before `action` runs, with no symptom pointing at "the form is missing
 * a field." Composing this instead of retyping the two `<input>`s keeps the required field
 * present for this package's own two views AND any consumer's hand-rolled form.
 *
 * `phone` (optional, alongside `email`) covers the identical `_csrf`-plus-one-subject-field shape
 * for a phone-keyed form, such as an app's own profile form posting straight to `phone/enroll`.
 *
 * ## Returns a plain array, never a wrapping element
 *
 * Meant to be called as a plain function and spread directly into the surrounding `<form>`'s own
 * children — `h('form', props, ...authHiddenFields({ csrfToken, email }), ...restOfForm)` — never
 * invoked as `h(AuthHiddenFields, props)`. A wrapping element (a `<div>` or a `Fragment` requiring
 * its own per-renderer import) would add a DOM node / import for no reason: `h`'s own variadic
 * children already flatten a spread array exactly like any other list of children, in both React
 * and Preact.
 */
export function createAuthHiddenFields<E>(
  h: CreateElement<E>,
): (props: AuthHiddenFieldsProps) => E[] {
  return function authHiddenFields({ csrfToken, email, phone }: AuthHiddenFieldsProps): E[] {
    const fields = [h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' })]
    if (email !== undefined) {
      fields.push(h('input', { type: 'hidden', name: 'email', value: email }))
    }
    if (phone !== undefined) {
      fields.push(h('input', { type: 'hidden', name: 'phone', value: phone }))
    }
    return fields
  }
}
