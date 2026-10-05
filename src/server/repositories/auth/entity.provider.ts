import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { AuthenticationAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { computeEmailKeyId } from './email-key.ts'

/**
 * Provider for the `auth` model — credentials and session-lifecycle state for this project's
 * `auth` domain. See `model.defs.ts` for why this stays separate from the `users` collection.
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
   *   creation time (e.g. a not-yet-set password for an OAuth2-only account), `roleIds` included.
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

  /** Finds the `auth` record linked to the `users` profile `userId`. */
  public findByUserId(userId?: string) {
    if (!userId) return undefined
    return this.Model.findOne({ userId }).exec()
  }

  /** The `{ id, userId, roleIds }` of the accounts linked to the profiles `userIds`, with one
   * query; only what a listing needs to join accounts to people. */
  public async findRolesByUserIds(userIds: string[]) {
    if (!userIds.length) return []
    const accounts = await this.Model.find({ userId: { $in: userIds } }).select('userId roleIds')
      .exec()
    return accounts.map((account) => ({
      id: String(account.id),
      userId: String(account.userId),
      roleIds: (account.roleIds ?? []).map(String),
    }))
  }

  /** How many accounts hold `roleId`. */
  public countHolders(roleId: string) {
    return this.Model.countDocuments({ roleIds: roleId }).exec()
  }

  /** One page of the accounts holding `roleId`, as `{ id, userId }`, plus how many hold it. */
  public async searchHolders(roleId: string, options: { page?: number; limit?: number } = {}) {
    const result = await this.Model.paginate({
      page: options.page,
      limit: options.limit,
      sort: { _id: 1 },
      filter: { roleIds: roleId },
    })
    return {
      total: result.total,
      page: result.page,
      limit: result.limit,
      docs: result.docs.map((account) => ({
        id: String(account.id),
        userId: account.userId ? String(account.userId) : undefined,
      })),
    }
  }

  /**
   * Finds an `auth` record by its login `email` (see `model.defs.ts`'s own `email` field doc).
   * Queries by the
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

  /**
   * Adds `roleIds` to the roles of an account, atomically (`$addToSet`): a role it already holds
   * stays where it is, the new ones go after. Concurrent additions never undo each other.
   * ⚠️ Validate that the account and the roles exist before calling.
   */
  public addRoleIds(authId: string, roleIds: string[]) {
    return this.Model.updateOne({ _id: authId }, { $addToSet: { roleIds: { $each: roleIds } } })
      .exec()
  }

  /**
   * Replaces the roles of an account with `next`, only if they are still exactly `expected` (the
   * list the caller read and checked its rules against). Answers whether the write happened; a
   * `false` means the account changed in between and the caller must read it again.
   */
  public async replaceRoleIds(authId: string, expected: string[], next: string[]) {
    const result = await this.Model.updateOne(
      { _id: authId, ...this.#rolesAre(expected) },
      { $set: { roleIds: next } },
    ).exec()
    return result.matchedCount > 0
  }

  /**
   * Removes `roleIds` from an account (`$pull`), only if its roles are still exactly `expected`.
   * Answers whether the write happened, like {@linkcode replaceRoleIds}.
   */
  public async pullRoleIds(authId: string, expected: string[], roleIds: string[]) {
    const result = await this.Model.updateOne(
      { _id: authId, ...this.#rolesAre(expected) },
      { $pull: { roleIds: { $in: roleIds } } },
    ).exec()
    return result.matchedCount > 0
  }

  /** The filter matching an account whose `roleIds` are exactly `roleIds` (an empty list also
   * matches an account that has no `roleIds` field yet). */
  #rolesAre(roleIds: string[]) {
    return roleIds.length
      ? { roleIds }
      : { $or: [{ roleIds: { $exists: false } }, { roleIds: { $size: 0 } }] }
  }

  /**
   * The accounts, other than `exceptAuthId`, that hold at least one of `roleIds`, as
   * `{ id, userId? }` — only what the caller needs to ask whether each can still sign in.
   */
  public async findHoldersOfRoleIds(roleIds: string[], exceptAuthId?: string) {
    const holders = await this.Model.find({
      roleIds: { $in: roleIds },
      ...(exceptAuthId ? { _id: { $ne: exceptAuthId } } : {}),
    }).select('userId').exec()
    return holders.map((holder) => ({
      id: String(holder.id ?? holder._id),
      userId: holder.userId ? String(holder.userId) : undefined,
    }))
  }
}
