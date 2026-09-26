import type { ErrorBoundaryProps } from '@zanix/space'
import { OauthCallbackErrorView } from 'ui/pages/login-oauth-callback-error/index.ts'

/**
 * Friendly fallback for `../page.tsx`'s own `loader` throwing — an expired/invalid authorization
 * code, an unverified provider email, or an account already linked to a different sign-in method
 * (see that page's own doc for the full list). Never renders the raw thrown error to the visitor —
 * this is an end-user-facing page, not a maintainer log; the real error detail is left to this
 * project's own server-side error logging.
 *
 * Renders `@zanix/iam/ui/pages/login-oauth-callback-error`'s own factory-built view
 * (`createElement`-based, never JSX) — this file only adapts `@zanix/space`'s real
 * `ErrorBoundaryProps` shape into that view's own structural, dependency-free
 * `OauthCallbackErrorViewProps`.
 */
export default function OauthCallbackError({ params, reset }: ErrorBoundaryProps) {
  return OauthCallbackErrorView({ params, reset })
}
