import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { AuthenticationAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { computeEmailKeyId } from './email-key.ts'

/**
 * Provider for the `auth` model — credentials and session-lifecycle state for this project's
 * `auth` domain slice. See `model.defs.ts` for why this stays separate from the future `users`
 * collection.
 *
 * Decorated with an explicit `'authRepository'` slot (rather than the default class-identity
 * resolution) because this class is reached from `AuthService`/`PasswordService`, which this
 * project's Space pages (`login`, `logout`, `totp/*`, `password/recovery/*`) bind through
 * `@Page({ Interactor: ... })`. Those pages run through Vite's SSR pipeline, which re-evaluates
 * this file as a second, independent class object distinct from the one `zanix space dev`'s
 * native process already loaded to build the REST route table — two module evaluations of the
 * same source produce two different class references sharing nothing but a name. A plain
 * `@Provider()` resolves by class-object identity, so `this.providers.get(AuthRepository)` from
 * one evaluation could never find the instance the other evaluation registered. The named slot
 * resolves through a shared string alias instead, so whichever evaluation constructs the instance
 * first is the one every later lookup — from either evaluation — keeps returning.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider('authRepository')
export class AuthRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `auth` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<AuthenticationAttrs>('auth')
  }

  /**
   * Creates a new `auth` record. `emailKeyId` — the real, indexed lookup key `findByEmail` queries
   * against — is derived here, from `authData.email`, so no caller ever has to remember to compute
   * it itself (see `email-key.ts`'s own doc for why `email` alone can't be queried directly once
   * it's stored masked).
   *
   * @param authData Fields to persist — `email` is required, everything else is optional at
   *   creation time (e.g. a not-yet-set password for an OAuth2-only account).
   */
  public async registerAuth(authData: Partial<AuthenticationAttrs> & { email: string }) {
    const emailKeyId = await computeEmailKeyId(authData.email)
    const authDoc = new this.Model({ ...authData, emailKeyId })
    return authDoc.save()
  }

  /** Finds an `auth` record by its own `id`. */
  public findById(authId?: string) {
    if (!authId) return undefined
    return this.Model.findById(authId).exec()
  }

  /**
   * Finds an `auth` record by its login `email` — the sole account-lookup path this slice needs
   * until the `users` slice exists (see `model.defs.ts`'s own `email` field doc). Queries by the
   * deterministic `emailKeyId` digest, never the masked `email` field itself, which the database
   * has no way to match against a plaintext filter directly.
   */
  public async findByEmail(email: string) {
    const emailKeyId = await computeEmailKeyId(email)
    return await this.Model.findOne({ emailKeyId }).exec()
  }

  /**
   * Updates an existing `auth` record.
   * ⚠️ Ensure that only existing records are updated, or validate their existence before
   * performing the update.
   *
   * @param authData Fields to update — must include `id`.
   * @param options.applyProtection Whether to apply this model's own data policies (hash/encrypt
   *   getters) to the fields being written, e.g. hashing a plain-text `password`.
   * @param options.unset Field names to remove entirely (e.g. clearing `mustChangePassword`).
   */
  public updateAuth(
    authData: Partial<AuthenticationAttrs> & { id: string },
    options: {
      applyProtection?: boolean
      unset?: (keyof AuthenticationAttrs)[]
    } = {},
  ) {
    const { applyProtection, unset } = options
    const { id, ...data } = authData

    const opts: Record<string, unknown> = { $set: data }
    if (unset) {
      opts.$unset = unset.reduce((acc, key) => {
        acc[key as never] = '' as never
        return acc
      }, {} as Record<string, unknown>)
    }

    return this.Model.updateOne({ _id: id }, opts, { useDataPolicies: applyProtection }).exec()
  }
}
