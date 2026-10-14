import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { StepUpClaimAttrs } from './model.defs.ts'

import { Provider, ZanixProvider } from '@zanix/server'

/** Whether a write was refused by a unique index (MongoDB error 11000). */
function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as { code?: number; message?: string } | undefined
  return candidate?.code === 11000 || candidate?.message?.includes('E11000') === true
}

/**
 * Provider for the `step_up_claim` model: values that may be used once. Registered under the
 * `'stepUpClaimRepository'` slot for the reason `AuthRepository` gives: the interactors that use it
 * are also bound by Space pages, which evaluate this file a second time.
 *
 * @class
 * @extends ZanixProvider
 */
@Provider('stepUpClaimRepository')
export class StepUpClaimRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** The Mongoose model bound to the `step_up_claim` collection. */
  private Model
  constructor() {
    super()
    this.Model = this.database.getModel<StepUpClaimAttrs>('step_up_claim')
  }

  /**
   * Claims `key`. The unique index decides a race, so exactly one caller ever holds a key.
   *
   * @param key Digest of the value to use once.
   * @param expireAt When the record may be deleted: after the value has expired on its own.
   * @returns `true` when this call holds the claim, `false` when it was already held.
   * @throws {Error} Any database error other than a duplicate key.
   */
  public async claim(key: string, expireAt: Date): Promise<boolean> {
    try {
      await this.Model.create({ key, expireAt })
      return true
    } catch (error) {
      if (isDuplicateKeyError(error)) return false
      throw error
    }
  }
}
