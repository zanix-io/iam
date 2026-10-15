import { defineValidationDecorator } from '@zanix/validator'

/** The longest operator id a service may vouch for. */
export const OPERATOR_ID_MAX = 128

/** An opaque id of the service's own directory: letters, digits and `_ . : @ -`, no spaces. */
const OPERATOR_ID = new RegExp(`^[A-Za-z0-9_.:@-]{1,${OPERATOR_ID_MAX}}$`)

/**
 * Whether `value` is `{ id }` with nothing else and an `id` of the shape {@linkcode OPERATOR_ID_MAX}
 * and the character set above allow. The id is opaque to `iam`: it only travels into the audit
 * trail, so it is kept to a shape that cannot carry markup or control characters.
 */
export function isOperatorRef(value?: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  const id = (value as { id?: unknown }).id
  return keys.length === 1 && keys[0] === 'id' && typeof id === 'string' && OPERATOR_ID.test(id)
}

/**
 * Decorator to validate the `operator` of a service call: `{ id: string }` as {@linkcode isOperatorRef}
 * describes.
 *
 * @param options Optional validation settings, including a custom error message.
 */
export function IsOperatorRef(
  options: Parameters<typeof defineValidationDecorator>[1] = {},
): ReturnType<typeof defineValidationDecorator> {
  return defineValidationDecorator(isOperatorRef, {
    message: (property: string) =>
      `The '${property}' property must be { id } with an id of 1 to ${OPERATOR_ID_MAX} ` +
      'letters, digits or _ . : @ -.',
    ...options,
  })
}
