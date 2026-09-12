/**
 * Validates a new/changed password before it's submitted to `POST /pwd/change` or
 * `POST /pwd/recovery/callback` — mirrors `iam`'s own server-side default password policy
 * (`iam/src/server/apps/auth.app.ts`'s `passwordPolicy` behavior) as a plain function, since there
 * is no `@zanix/app` runtime on the client to resolve a `behaviors` override through.
 *
 * **A deployment that overrides `auth.app.ts`'s `passwordPolicy` behavior (a different length,
 * character-class, or breached-password rule) makes this function's rules diverge from what the
 * server actually enforces** — this is a client-side pre-check for fast inline feedback, never a
 * substitute for the server's own validation, which always runs regardless of what this returns.
 *
 * @returns `true` when the password satisfies the default policy, or the same human-readable
 * message `iam`'s own server-side policy would reject it with otherwise.
 */
export function validatePassword(password: string): true | string {
  if (password.length < 8) return 'Password must be at least 8 characters long.'
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.'
  if (!/[0-9]/.test(password)) return 'Password must contain a digit.'
  return true
}
