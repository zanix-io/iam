/**
 * A plain, stateless PRG (post-redirect-get) response — the one shape every space `action`/`static
 * redirect` in this project needs, so no two page controllers hand-roll their own `new Response(null,
 * {status, headers})` call. `@zanix/space` doesn't export an equivalent of its own.
 *
 * @param location - The `Location` header value — a path or full URL.
 * @param status - `303` (See Other, the default — always a `GET` on the redirected request,
 * regardless of the original method) or `302` (Found — some older clients replay the original
 * method). `303` is correct for the overwhelming majority of this app's own redirects (a POST
 * `action` finishing, an already-authenticated GET bouncing away from a login/challenge page).
 */
export function redirectResponse(location: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { location } })
}
