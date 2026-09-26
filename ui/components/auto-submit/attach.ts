/**
 * Auto-submits the target form the instant this Comet mounts. Renderer-agnostic (zero React/
 * Preact import), same shape `submit-guard.ts` (`@zanix/space`) establishes for a hook-free DOM
 * primitive a `useEffect` binding calls into.
 *
 * Promoted here from `login-oauth-start/auto-submit` (its original home) — nothing about the
 * implementation was ever actually OAuth-specific, so keeping it nested inside that one page's own
 * directory would have misrepresented it as page-local when it's really a generic, reusable
 * primitive, the same `ui/components/` convention `rate-limit-countdown`/`otp-code-field` already
 * establish.
 *
 * Without this, a visitor who already committed to an action on a PREVIOUS screen (chose "Continue
 * with {provider}") has to repeat what reads as the same step a second time before anything
 * happens (see `login-oauth-start`'s own doc). A no-JS visitor (or one whose hydration hasn't finished) never
 * runs this and still gets a completely valid, working button to click manually — this Comet's own
 * presence never hides or disables it.
 *
 * `requestSubmit()`, not `.submit()`: this is the form's very first, only submit attempt — its one
 * submit control has nothing disabling it yet, so `requestSubmit()`'s own real submitter-aware
 * semantics apply cleanly, AND — unlike `.submit()` — it dispatches a real, cancelable `submit`
 * event, which a `SubmitGuard` mounted on the same form still needs to see so its own
 * double-submit protection keeps working normally.
 *
 * @returns A no-op cleanup — nothing is attached that outlives this call (a single, one-shot
 * `requestSubmit()`, not a listener), kept only so this primitive's own signature matches every
 * other `attachX` primitive's `useEffect(() => attachX(...), deps)` contract.
 */
export function attachAutoSubmit(formId: string): () => void {
  const form = globalThis.document?.getElementById(formId)
  if (form instanceof HTMLFormElement) form.requestSubmit()
  return () => {}
}
