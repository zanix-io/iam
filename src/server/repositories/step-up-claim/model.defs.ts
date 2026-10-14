import { registerModel } from '@zanix/datamaster'

/**
 * A claim on a value that may be used once: the step-up token id (`jti`) of a factor change, a
 * TOTP code of an account, a step-up one-time code. The record's only purpose is to exist, so the
 * unique index on `key` decides which of two concurrent uses wins, and it disappears once the value
 * it guards can no longer be presented.
 */
export type StepUpClaimAttrs = {
  id: string
  /** Digest of what is claimed, prefixed with its kind (`jti`, `totp`, `otp`). */
  key: string
  /** When MongoDB deletes this record: after the claimed value has expired on its own. */
  expireAt: Date
  createdAt: Date
  updatedAt: Date
}

registerModel<StepUpClaimAttrs>({
  name: 'step_up_claim',
  definition: {
    key: { type: String, required: true },
    expireAt: { type: Date, required: true },
  },
  options: {
    timestamps: true,
  },
  callback: (schema) => {
    // The unique index makes a claim atomic: of two concurrent inserts, one is refused.
    schema.index({ key: 1 }, { unique: true })
    // TTL index: MongoDB removes a record once `expireAt` has passed.
    schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })
    return schema
  },
})
