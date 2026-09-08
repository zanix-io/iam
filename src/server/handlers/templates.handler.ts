import { createTemplatesController } from '@zanix/notifications/templates-api'
import { jwtValidationGuard } from '@zanix/auth'

/**
 * This project's local `/templates` CRUD API — `@zanix/notifications`'s own
 * `createTemplatesController`, which owns the schema/collection/HTTP surface end-to-end (see
 * `notifications-template-storage-modes`); this file only supplies the auth guard, per
 * `zanix-server-internals`'s "auth is never assumed" rule.
 *
 * What makes this project's templates editable at all (both here and, once
 * `@zanix/admin`'s cross-service `POST /templates/sync` pulls from this project's own
 * `/.well-known/zanix/code-templates` Discovery — see `mod.ts`'s `codeTemplatesDiscovery: true` —
 * from a central console's own copy) is `TEMPLATES_BACKEND=local` being set (see this project's
 * own `.env.example`/README) — with it unset, every template still renders, just from compiled
 * code, and any edit through this controller has nothing durable to persist to.
 */
const templatesController: ReturnType<typeof createTemplatesController> = createTemplatesController(
  {
    guards: [jwtValidationGuard({ permissions: ['iam:templates'], type: ['user', 'api'] })],
  },
)

export default templatesController
