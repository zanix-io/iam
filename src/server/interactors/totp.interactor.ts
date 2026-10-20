import type { HydratedAuth } from '../repositories/auth/model.defs.ts'
import type { AuthSessionOptions } from '@zanix/auth'
import { Interactor, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { ZanixAuthProvider } from '@zanix/auth'
import { resolveBehavior, resolveConfig } from '@zanix/app/runtime'
import { AuthRepository } from '../repositories/auth/entity.provider.ts'
import { UsersRepository } from '../repositories/users/entity.provider.ts'
import {
  IAM_ERROR_CODES,
  LOGIN_ACTIONS,
  resolveConfiguredAccessExpiration,
  resolveConfiguredRefreshExpiration,
  SERVICE_ID,
  TOKEN_EXPIRATION,
  TOTP_ENROLLMENT_TTL_SECONDS,
} from 'utils/constants.ts'
import { FACTOR_CHANGE_PURPOSE, type FactorChangeOperation } from 'utils/shared-enums.ts'
import { STEP_UP_TOKEN_LOCALS_KEY } from 'utils/step-up-token-guard.ts'
import { timingSafeStringEqual } from 'utils/oauth-provider.ts'
import { permissionsForAccount } from './session-permissions.ts'
import { emailVerifiedPayload } from './email-proof.ts'
import { claimOnce, requireFactorChangeProof } from './step-up-proof.ts'
import { StepUpService } from './step-up.interactor.ts'
import { type AccountNoticeTemplate, sendAccountNotice } from './account-notice.ts'
import { createBackupCodeSet, replaceBackupCodes, spendBackupCode } from './backup-codes.ts'
import { normalizeBackupCode } from 'utils/backup-codes.ts'
import { SessionService } from './session.interactor.ts'

/**
 * The refusal of a sign-in code that does not match. It is the error `@zanix/auth`'s
 * `totp.authenticate` raises for a wrong authenticator code, so a wrong backup code is
 * indistinguishable from it.
 */
function invalidTotpCode(): HttpError {
  return new HttpError('FORBIDDEN', {
    code: 'INVALID_TOTP',
    cause: 'The provided TOTP code does not match the expected value.',
    meta: { source: 'zanix' },
  })
}

/**
 * The authenticator app and backup codes: enrolment, confirmation, removal, the second-factor
 * sign-in, and the step-up proofs a factor change needs.
 */
@Interactor()
export class TotpService extends ZanixInteractor {
  /**
   * Begins TOTP enrollment for the current authenticated session: generates a new secret and its
   * provisioning URI and keeps the secret as the account's PENDING secret for
   * {@linkcode TOTP_ENROLLMENT_TTL_SECONDS}. `totpConfirm` confirms that secret and no other, so a
   * client cannot choose the secret that becomes the account's second factor. Enrolling again
   * replaces the pending secret; the active `totpSecret` is untouched until a confirmation.
   *
   * **Resolves the account's real email before building the label**: `subject`
   * (`this.context.session.subject`) is the token's `sub` claim, which is `auth.id` (see every
   * `session.generateTokens({ subject: auth.id, ... })` call site in this file), never the login
   * email, while `totpProvisioningLabel`'s default (`auth.app.ts`) is the identity function
   * `(email) => email`.
   *
   * @throws {HttpError} `UNAUTHORIZED` when called with no authenticated session; `FORBIDDEN` when
   *   the session subject no longer resolves to a real `auth` record.
   */
  public async totpEnroll() {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const auth = await this.providers.get(AuthRepository).findById(subject) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    const email = auth.email?.unmask() ?? subject

    const totp = this.providers.get(ZanixAuthProvider).totp
    const secret = totp.generateSecret()
    const label =
      resolveBehavior<(email: string) => string>('auth', 'totpProvisioningLabel')?.(email) ??
        email
    const uri = totp.getProvisioningUri(secret, label, { issuer: SERVICE_ID })

    await this.providers.get(AuthRepository).updateAuth({
      id: subject,
      pendingTotpSecret: secret,
      pendingTotpExpiresAt: new Date(Date.now() + TOTP_ENROLLMENT_TTL_SECONDS * 1000),
    }, { applyProtection: true })

    return { secret, uri }
  }

  /**
   * Confirms a TOTP enrollment: verifies `code` against the pending secret `totpEnroll` issued and,
   * only on success, makes it the account's `totpSecret` and enables TOTP as its 2FA method on
   * login. Changing the second factor needs a fresh `factor-change` step-up proof for
   * `totp-confirm` ({@linkcode requireFactorChangeProof}); it is spent only after the code
   * matched, so a mistyped code costs no proof. A code is accepted once per account within its
   * window.
   *
   * Enabling TOTP also issues the account's backup codes (a fresh set, replacing any earlier one):
   * `backupCodes` in the answer is the only time they are shown; the database keeps their digests.
   *
   * @param secret The secret a client says it enrolled. Never used as the secret: when present it
   *   must equal the pending one, so a body that carries another secret is refused.
   * @throws {HttpError} `UNAUTHORIZED` with no authenticated session; `FORBIDDEN` for a missing,
   *   invalid or spent proof, a secret that is not the pending one, or a code that does not match;
   *   `BAD_REQUEST` when no enrollment is pending or it has expired.
   */
  public async totpConfirm(code: string, secret?: string) {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })

    const proof = await requireFactorChangeProof(
      this.providers,
      this.context,
      subject,
      'totp-confirm',
    )

    const auth = await this.providers.get(AuthRepository).findById(subject) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })

    const pending = await auth.pendingTotpSecret?.decrypt()
    const expiresAt = auth.pendingTotpExpiresAt?.getTime() ?? 0
    if (!pending || expiresAt <= Date.now()) {
      throw new HttpError('BAD_REQUEST', {
        message: 'No authenticator-app enrollment is pending. Start the enrollment again.',
      })
    }
    if (secret !== undefined && !timingSafeStringEqual(secret, pending)) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })
    }

    const window = resolveConfig<number>('auth', 'totpToleranceSteps') ?? 1
    const verified = await this.providers.get(ZanixAuthProvider).totp.verify(pending, code, {
      window,
    })
    if (!verified || !await this.claimTotpCode(subject, code, window)) {
      throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })
    }

    await proof.spend()

    // The backup codes are stored in the write that enables TOTP, so there is no moment with TOTP
    // on and a half-written set.
    const { codes, fields } = await createBackupCodeSet(subject)
    await this.providers.get(AuthRepository).updateAuth({
      id: subject,
      totpSecret: pending,
      twoFactorAuthConfig: { method: 'totp', triggerOn: [...LOGIN_ACTIONS] },
      ...fields,
    }, { applyProtection: true, unset: ['pendingTotpSecret', 'pendingTotpExpiresAt'] })

    await this.notifyTotpChange(auth.email?.unmask(), 'totp-enabled')

    return { response: 'TOTP enabled', backupCodes: codes }
  }

  /**
   * Claims `code` for `authId`, so an authenticator code is accepted once within the span of
   * steps a verification tolerates (`window` steps either side of the current one, 30 s each).
   *
   * @returns `false` when the code was already used.
   */
  private claimTotpCode(authId: string, code: string, window: number): Promise<boolean> {
    return claimOnce(this.providers, 'totp', `${authId}:${code}`, (2 * window + 1) * 30)
  }

  /**
   * Verifies the second-factor `code` of the signed-in account for the `factor-change` purpose and
   * `operation`, and records the resulting step-up token for the rest of this request, where the
   * operation's own proof check finds it. For the hosted pages, which take the code in the same
   * form as the change; an API client sends the token in the step-up header instead.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` when the code does not verify.
   */
  public async provideFactorChangeProof(operation: FactorChangeOperation, code: string) {
    const { stepUpToken } = await this.interactors.get(StepUpService).verify(
      FACTOR_CHANGE_PURPOSE,
      code,
      operation,
    )
    if (this.context.locals) this.context.locals[STEP_UP_TOKEN_LOCALS_KEY] = stepUpToken
  }

  /**
   * Starts the `factor-change` step-up for the signed-in account (see {@linkcode StepUpService.request}):
   * the page that takes the confirmation code calls it to deliver one. Answers which factor the
   * account needs.
   */
  public async requestFactorChangeProof() {
    return await this.interactors.get(StepUpService).request(FACTOR_CHANGE_PURPOSE)
  }

  /**
   * Disables TOTP (authenticator-app) 2FA for the caller's OWN account — the counterpart to
   * `totpConfirm`, clearing both the persisted `totpSecret` and the `twoFactorAuthConfig` that
   * enables it on login, and the backup codes with them. Only writes when TOTP is actually the account's configured method — same
   * conditional-unset shape as `unlinkOauth`'s own `oauthProvider` check — since
   * `twoFactorAuthConfig.method` can also be an OTP notifier (`TWO_FACTOR_METHODS`), which this
   * must never clear.
   *
   * No "last remaining method" guard — see `unlinkOauth`'s own doc.
   *
   * Needs a fresh `factor-change` step-up proof for `totp-disable`, so a session alone cannot turn
   * the second factor off.
   *
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` for a missing, invalid or
   *   spent proof, or when the session subject no longer resolves to a real `auth` record.
   */
  public async disableTotp() {
    const authId = this.context.session?.subject
    if (!authId) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
    const proof = await requireFactorChangeProof(
      this.providers,
      this.context,
      authId,
      'totp-disable',
    )

    const auth = await this.providers.get(AuthRepository).findById(authId) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    await proof.spend()

    if (auth.twoFactorAuthConfig?.method === 'totp') {
      await this.providers.get(AuthRepository).updateAuth(
        { id: authId },
        {
          unset: [
            'totpSecret',
            'twoFactorAuthConfig',
            'pendingTotpSecret',
            'pendingTotpExpiresAt',
            'backupCodeHashes',
            'backupCodesGeneratedAt',
          ],
        },
      )
      await this.notifyTotpChange(auth.email?.unmask(), 'totp-disabled')
    }
    return { response: 'TOTP disabled' }
  }

  /**
   * Tells the account's owner by email that the second factor was turned on or off (see
   * {@linkcode sendAccountNotice} for when nothing is sent).
   *
   * @param to The account's email, unmasked; `undefined` when it has none.
   * @param template Which notice to send.
   */
  private notifyTotpChange(
    to: string | undefined,
    template: Extract<AccountNoticeTemplate, 'totp-enabled' | 'totp-disabled'>,
  ): Promise<void> {
    return sendAccountNotice(this.providers, this.context, to, template)
  }

  /**
   * Replaces the backup codes of the signed-in account with a new set and answers it. The old codes
   * stop working at the same instant. Needs a fresh `factor-change` step-up proof for
   * `totp-backup-codes`; the proof is checked before the account and spent only once the account is
   * known to have an authenticator app, so a refused request costs no proof. This is also how an
   * account that enabled TOTP before backup codes existed gets its first set.
   *
   * @returns `{ backupCodes }`: the only time the codes are shown.
   * @throws {HttpError} `UNAUTHORIZED` with no session; `FORBIDDEN` for a missing, invalid or
   *   spent proof or an account that no longer exists; `CONFLICT` (`TOTP_NOT_ENABLED`) when the
   *   account has no authenticator app.
   */
  public async regenerateBackupCodes() {
    const subject = this.context.session?.subject
    if (!subject) throw new HttpError('UNAUTHORIZED', { message: 'Authentication required.' })
    const proof = await requireFactorChangeProof(
      this.providers,
      this.context,
      subject,
      'totp-backup-codes',
    )

    const auth = await this.providers.get(AuthRepository).findById(subject) as
      | HydratedAuth
      | undefined
    if (!auth) throw new HttpError('FORBIDDEN', { message: 'Account not found.' })
    if (auth.twoFactorAuthConfig?.method !== 'totp') {
      throw new HttpError('CONFLICT', {
        message: 'Backup codes need an authenticator app. Enable one first.',
        code: IAM_ERROR_CODES.totpNotEnabled,
      })
    }
    await proof.spend()

    return { backupCodes: await replaceBackupCodes(this.providers, subject) }
  }

  /**
   * Verifies the authenticator-app `code` sent for `email`'s TOTP-secured login and, on success,
   * issues session tokens — the same configured `accessExpiration`/`refreshExpiration` as
   * `finishLogin` (see its own doc for why).
   *
   * `code` is an authenticator code or one of the account's backup codes (see
   * {@linkcode spendBackupCode}); a backup code is spent by signing in and its owner is emailed.
   *
   * @throws {HttpError} `FORBIDDEN` when the account has no TOTP secret enrolled, when the linked
   *   `users` profile is deactivated/deleted (`UsersRepository.assertActive`), or when `code`
   *   doesn't match: the same refusal for a wrong authenticator code and a wrong backup code.
   */
  public async loginWithTOTPCallback(email: string, code: string) {
    const auth = await this.providers.get(AuthRepository).findByEmail(
      email,
    ) as unknown as HydratedAuth
    const secret = await auth?.totpSecret?.decrypt()
    if (!secret) {
      throw new HttpError('FORBIDDEN', { message: 'TOTP is not enabled for this account.' })
    }
    await this.providers.get(UsersRepository).assertActive(auth.userId)

    const permissions = await permissionsForAccount(this.providers, auth)
    // Same cast as `finishLogin` — see its own doc for why.
    const accessExpiration = resolveConfiguredAccessExpiration() as
      | AuthSessionOptions['accessExpiration']
      | undefined
    const refreshExpiration = resolveConfiguredRefreshExpiration() as
      | AuthSessionOptions['refreshExpiration']
      | undefined
    const sessionOptions = {
      subject: auth.id,
      permissions,
      ...emailVerifiedPayload(Boolean(auth.emailVerifiedAt)),
      ...(accessExpiration !== undefined ? { accessExpiration } : {}),
      ...(refreshExpiration !== undefined ? { refreshExpiration } : {}),
    }

    let tokens
    if (normalizeBackupCode(code)) {
      // A backup code takes the place of the authenticator code. A refusal is the one a wrong
      // authenticator code gets, so the answer does not tell which kind of code was tried.
      if (!await this.spendBackupCode(auth, code)) throw invalidTotpCode()
      tokens = await this.providers.get(ZanixAuthProvider).session.generateTokens(sessionOptions)
    } else {
      const window = resolveConfig<number>('auth', 'totpToleranceSteps') ?? 1
      // A code signs in once within its window: the claim comes first, so a replay (also a
      // concurrent one) is refused before it can mint a session.
      if (!await this.claimTotpCode(auth.id, code, window)) {
        throw new HttpError('FORBIDDEN', { message: 'Invalid TOTP code.' })
      }
      tokens = await this.providers.get(ZanixAuthProvider).totp.authenticate(
        secret,
        code,
        sessionOptions,
        { window },
      )
    }

    await this.interactors.get(SessionService).persistSession(auth.id)
    return { ...tokens, expiresAt: TOKEN_EXPIRATION }
  }

  /** Spends a backup code of `auth` and tells its owner; see {@linkcode spendBackupCode}. */
  private spendBackupCode(auth: HydratedAuth, code: string): Promise<boolean> {
    return spendBackupCode(
      this.providers,
      auth,
      code,
      (to, remaining) =>
        sendAccountNotice(this.providers, this.context, to, 'totp-backup-code-used', { remaining }),
    )
  }
}
