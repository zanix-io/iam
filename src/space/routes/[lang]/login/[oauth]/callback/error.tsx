import type { ErrorBoundaryProps } from '@zanix/space'
import { Button } from '@zanix/space-ui'

/**
 * Friendly fallback for `../page.tsx`'s own `loader` throwing — an expired/invalid authorization
 * code, an unverified provider email, or an account already linked to a different sign-in method
 * (see that page's own doc for the full list). Never renders the raw thrown error to the visitor —
 * this is an end-user-facing page, not a maintainer log (see `zanix-observability-conventions`'s
 * audience-per-subrepo table); the real error detail is left to this project's own server-side
 * error logging, unchanged by this boundary.
 */
export default function OauthCallbackError({ params, reset }: ErrorBoundaryProps) {
  const lang = (params as { lang?: string }).lang ?? 'en'
  return (
    <main data-space='error'>
      <h1>Sign-in didn't complete</h1>
      <p>Something went wrong finishing sign-in. You can try again from the sign-in page.</p>
      <p>
        <a href={`/${lang}/login`}>Back to sign in</a>
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  )
}
