import type { LoginTwoStepProps } from './types.ts'

/** The `useSubmitIntercept` hook of the renderer's own `@zanix/space/comet/*` binding, injected so
 * one factory serves both renderers. */
export type LoginTwoStepDeps = {
  useSubmitIntercept: (
    options: {
      formId: string
      intercept: (form: HTMLFormElement) => Promise<'handled' | 'proceed'>
    },
  ) => void
}

/** The CSRF header `@zanix/space`'s `csrfGuard` reads on a non-form request. */
const CSRF_HEADER = 'X-Znx-Csrf-Token'

/**
 * Swaps the email step for the password step in place and hands the typed email to it.
 * `querySelectorAll`, not `querySelector`: the password step can carry more than one form (sign-in
 * and password recovery), each with its own hidden `email` input.
 */
function revealPasswordStep(email: string): void {
  document.querySelector('[data-login-step="email"]')?.setAttribute('hidden', '')
  const passwordStep = document.querySelector('[data-login-step="password"]')
  passwordStep?.removeAttribute('hidden')

  passwordStep?.querySelectorAll<HTMLInputElement>('input[name="email"]').forEach((field) => {
    field.value = email
  })
  const emailDisplay = passwordStep?.querySelector<HTMLElement>('[data-login-email-display]')
  if (emailDisplay) emailDisplay.textContent = email

  passwordStep?.querySelector<HTMLInputElement>('input[name="password"]')?.focus()
}

/**
 * The headless behavior Comet of a two-step sign-in: it intercepts the email step's submit, asks
 * the methods endpoint whether that email has a password, and either reveals the password step in
 * place (`'handled'`) or lets the form submit for real (`'proceed'`). A failed lookup also proceeds,
 * so the server-side handling of the submitted form stays the one authoritative decision; a visitor
 * without JavaScript never runs this and gets the same result from that submit.
 *
 * It renders nothing and reaches the two steps through the DOM, because a Comet is its own
 * hydration root and shares no state with the page markup around it. The contract it relies on:
 * - the email step's `<form id>` (`formId`) holding an `input[name="email"]`;
 * - `[data-login-step="email"]` and `[data-login-step="password"]` blocks, toggled through the
 *   `hidden` attribute (a page's CSP may block inline `style`, and `hidden` needs no stylesheet);
 * - `input[name="email"]`, `input[name="password"]` and `[data-login-email-display]` inside the
 *   password step, which `LoginPasswordStep` renders.
 */
export function createLoginTwoStep(
  { useSubmitIntercept }: LoginTwoStepDeps,
): (props: LoginTwoStepProps) => null {
  return function LoginTwoStep(
    { lang, csrfToken, formId = 'login-form', methodsHref }: LoginTwoStepProps,
  ): null {
    useSubmitIntercept({
      formId,
      intercept: async (form) => {
        const email = form.querySelector<HTMLInputElement>('input[name="email"]')?.value?.trim()
        if (!email) return 'proceed'

        let hasPassword = false
        try {
          const response = await fetch(methodsHref ?? `/${lang}/login/methods`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: csrfToken ?? '' },
            body: JSON.stringify({ email }),
          })
          if (response.ok) {
            hasPassword = Boolean(
              ((await response.json()) as { hasPassword?: boolean }).hasPassword,
            )
          }
        } catch {
          // A network failure proceeds like a lookup with no password would.
        }

        if (hasPassword) {
          revealPasswordStep(email)
          return 'handled'
        }
        return 'proceed'
      },
    })
    return null
  }
}
