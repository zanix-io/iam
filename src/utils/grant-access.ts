import type { GrantAccessAttrs } from 'server/repositories/grant-access/model.defs.ts'

import { DEFAULT_ACCESS_LEVELS } from './constants.ts'

/** The single grant record `defaultEvaluateGrantAccess` below (and any host override registered
 * under `grant-access.app.ts`'s own `evaluateGrantAccess` behavior) receives — `undefined`/`null`
 * covers no grant existing at all for the requested `userId`/`resourceId`/`tenantId` tuple. */
export type GrantAccessDoc = GrantAccessAttrs | undefined | null

/**
 * Default grant-evaluation strategy: does `grant` satisfy `requiredLevel`? An inactive or expired
 * grant never satisfies anything, regardless of `accessLevel`. When both `grant.accessLevel` and
 * `requiredLevel` are recognized `DEFAULT_ACCESS_LEVELS` (`utils/constants.ts`) values, satisfies
 * by ORDER — `grant.accessLevel`'s own index must be at least `requiredLevel`'s (`MANAGE`
 * satisfies a `READ` request; `READ` never satisfies a `WRITE` request). When either value falls
 * outside that list (a consumer's own custom level), falls back to plain equality — the same
 * bare, unordered comparison the grounding reference's own `accessLevel === 'MANAGE'` check used,
 * applied generically instead of hardcoding `'MANAGE'`.
 *
 * Registered as `grant-access.app.ts`'s own `evaluateGrantAccess` behavior default — a host may
 * override this entirely (a different hierarchy, a wildcard scheme, an external policy engine)
 * without forking `GrantAccessService`. See that manifest entry's own doc for the override
 * mechanism, and `app-behaviors-and-overrides` for the general pattern.
 */
export function defaultEvaluateGrantAccess(
  grant: GrantAccessDoc,
  requiredLevel: string,
): boolean {
  if (!grant?.isActive) return false
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) return false

  const grantIndex = DEFAULT_ACCESS_LEVELS.indexOf(
    grant.accessLevel as typeof DEFAULT_ACCESS_LEVELS[number],
  )
  const requiredIndex = DEFAULT_ACCESS_LEVELS.indexOf(
    requiredLevel as typeof DEFAULT_ACCESS_LEVELS[number],
  )
  if (grantIndex === -1 || requiredIndex === -1) return grant.accessLevel === requiredLevel

  return grantIndex >= requiredIndex
}
