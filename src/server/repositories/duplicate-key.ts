/** Whether a write was refused by a unique index (MongoDB error 11000). */
export function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as { code?: number; message?: string } | undefined
  return candidate?.code === 11000 || candidate?.message?.includes('E11000') === true
}
