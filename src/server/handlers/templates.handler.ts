import { isTemplatesResourceEnabled } from '@zanix/notifications'
import { createTemplatesController } from '@zanix/notifications/templates-api'
import { HttpError } from '@zanix/errors'
import { jwtValidationGuard } from '@zanix/auth'
import { RBAC_PERMISSIONS } from 'utils/constants.ts'

/**
 * This project's local `/templates` CRUD API — `@zanix/notifications`'s own
 * `createTemplatesController`, which owns the schema/collection/HTTP surface end-to-end; this file
 * only supplies the auth guard — the controller never assumes auth on its own.
 *
 * What makes this project's templates editable at all (both here and, when
 * `@zanix/admin`'s cross-service `POST /templates/sync` pulls from this project's own
 * `/.well-known/zanix/code-templates` Discovery — see `mod.ts`'s `codeTemplatesDiscovery: true` —
 * from a central console's own copy) is `TEMPLATES_BACKEND=local` being set (see this project's
 * own `.env.example`/README) — with it unset, every template still renders, just from compiled
 * code, and any edit through this controller has nothing durable to persist to.
 */
const templatesController: ReturnType<typeof createTemplatesController> = createTemplatesController(
  {
    guards: [
      jwtValidationGuard({
        permissions: [RBAC_PERMISSIONS.templatesAccess],
        type: ['user', 'api'],
      }),
      // Without `TEMPLATES_BACKEND=local` the templates model does not exist, so the controller
      // would fail with a 500 on every call: answer what is true instead. Checked per request, after
      // the token, so only a caller allowed to use the API learns it is off.
      () => {
        if (!isTemplatesResourceEnabled('local')) {
          throw new HttpError('NOT_FOUND', {
            message: 'The templates API needs TEMPLATES_BACKEND=local.',
            code: 'TEMPLATES_BACKEND_DISABLED',
          })
        }
        return {}
      },
    ],
  },
)

export default templatesController
