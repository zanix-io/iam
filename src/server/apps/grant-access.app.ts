import type { CheckGrantAccessRTO } from '../handlers/rtos/grant-access.ts'

import { defineZanixApp } from '@zanix/app'
import { resolveTarget } from '@zanix/app/runtime'
import { defaultEvaluateGrantAccess } from 'utils/grant-access.ts'
import { GrantAccessService } from '../interactors/grant-access.interactor.ts'

/**
 * The `grant-access` domain's own Zanix App — the customization/exposure layer for its
 * fine-grained, per-resource access grants (see `repositories/grant-access/model.defs.ts`'s own
 * doc for the full shape).
 *
 * **Why this gets its OWN manifest, rather than living on `auth.app.ts`** (where `roles`' own RBAC
 * evaluation lives): `resolveEffectivePermissions`
 * (`auth.app.ts`) is a LOGIN-time concern — evaluated once, embedded into a session token,
 * naturally owned by the app that mints that token. `evaluateGrantAccess` here is the opposite
 * shape: a PER-REQUEST, potentially CROSS-APP question ("does user X have access to resource Z
 * right now"), asked by code that has no reason to know or care about this project's login flow
 * — including code running in an entirely DIFFERENT `@zanix/app`-composed service, since this
 * product's own architecture can span several composed services that all need to ask the same
 * shared grant question (this is cross-SERVICE sharing within this one product's deployment, not
 * cross-PRODUCT isolation — see `RolesAttrs`'s own doc, `../repositories/roles/model.defs.ts`, for
 * that distinction). Bundling it onto `auth.app.ts` would
 * force every consumer of grant checks to depend on the login-time manifest too, and would misname
 * the concern. A second Zanix App, composed alongside `auth`, fits because this is new behavior
 * that doesn't replace anything existing, not a variation of an existing slot.
 *
 * `routes: false` deliberately, same reasoning as `auth.app.ts`: this app's job is
 * behavior/operation composition only. The real admin CRUD HTTP surface
 * (`GrantAccessController`) stays on this project's ordinary, unprefixed project-root
 * auto-discovery, gated by the plain `RBAC_PERMISSIONS.grantAccessRead`/`grantAccessWrite`
 * mechanism — see that controller's own doc.
 */
const grantAccessApp: ReturnType<typeof defineZanixApp> = defineZanixApp({
  name: 'grant-access',
  routes: false,
  runtime: { mode: 'embedded' },
  behaviors: {
    /**
     * The grant-evaluation strategy: given a grant record (or `undefined`/`null` when none
     * exists) and a required access level, returns whether it's satisfied. The default
     * (`defaultEvaluateGrantAccess`, see `utils/grant-access.ts`) is a simple, documented
     * ascending hierarchy over `DEFAULT_ACCESS_LEVELS` (`utils/constants.ts`), falling back to
     * exact-string equality for a level outside that list.
     *
     * Override to swap in an entirely different evaluation strategy — a different hierarchy, a
     * wildcard-expansion policy, an external policy engine — without forking
     * `GrantAccessService`.
     */
    evaluateGrantAccess: {
      default: defaultEvaluateGrantAccess,
      description:
        'Evaluates whether a grant record satisfies a required access level. Override to ' +
        'change the evaluation strategy (a different hierarchy, a wildcard-expansion policy, ' +
        'an external policy engine) without forking `GrantAccessService`.',
    },
  },
  operations: {
    /**
     * Exposes `GrantAccessService.checkAccess` to OTHER Zanix Apps — including ones running in a
     * different process — via `ctx.remote('grant-access').call('checkAccess', payload,
     * {timeoutMs})` (`@zanix/app`'s remote calls). This is the point of exposing grant checks as
     * a shared operation: a service composed alongside this one (or reachable from it over the
     * Control Plane) can ask "does this caller have access to my own resource" without this
     * service ever needing to know what that resource looks like — it only ever sees the
     * opaque `resourceId` string (see that field's own doc for the default
     * `"${appName}:${operationName}"` naming convention a caller checking one of ITS OWN
     * operations is expected to use).
     *
     * Deliberately public (`allowedCallers` omitted) — restricting which apps may ask "do I have
     * access to X" would defeat the whole purpose of exposing this as a shared operation; a host
     * wanting to restrict it can still set `allowedCallers` via `activateApps`'s own composition
     * call, this manifest just doesn't default to it.
     *
     * Resolves `GrantAccessService` via `resolveTarget` — the exact same DI resolution
     * `AppSetupContext.resolve()` uses internally — rather than `ctx.resolve()` itself, because
     * `RuntimeContext` (what an `operations` handler receives) deliberately does not expose
     * `resolve()`, only `setup(ctx)`'s own `AppSetupContext` does (see `resolveTarget`'s own doc,
     * `@zanix/app/runtime`).
     */
    checkAccess: async (payload) => {
      const service = resolveTarget('grant-access', GrantAccessService)
      const result = await service.checkAccess(payload as CheckGrantAccessRTO)
      return result satisfies { allowed: boolean }
    },
  },
})

export default grantAccessApp
