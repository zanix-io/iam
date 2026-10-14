import type { Providers } from 'utils/rbac.ts'

import { NotifierProvider, templatesBackendMode } from '@zanix/notifications'
import { contextMessageLang } from 'utils/message-lang.ts'

/** The database-only account-security templates `auth.app.ts` registers. */
export type AccountNoticeTemplate =
  | 'totp-enabled'
  | 'totp-disabled'
  | 'totp-backup-code-used'
  | 'totp-reset-by-operator'

/**
 * Tells the owner of an account by email that something changed in its second factor, so a session
 * that is not theirs cannot weaken the account unnoticed. The notice is a database-only template:
 * without a database-backed templates mode (`local`, or `remote` from a central catalog that carries
 * it) it does not exist (the worker would fail to render it), and without an email there is nobody
 * to tell, so nothing is sent.
 *
 * @param to The account's email, unmasked; `undefined` when it has none.
 * @param template Which notice to send.
 * @param data The variables of the template.
 */
export async function sendAccountNotice(
  providers: Providers,
  context: Parameters<typeof contextMessageLang>[0],
  to: string | undefined,
  template: AccountNoticeTemplate,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!to || !templatesBackendMode()) return
  // `zanixTemplate` is typed against `@zanix/notifications`' own BUILT-IN registry only — these are
  // real, database-only templates this project registers itself (`auth.app.ts`), genuinely unknown to
  // that static type. Cast, not a mistake.
  await providers.get(NotifierProvider).email({
    to,
    zanixTemplate: template,
    lang: contextMessageLang(context),
    data,
  } as never, { useWorker: 'one-time' })
}
