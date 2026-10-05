import { defineValidationDecorator, isEmail, stringLength } from '@zanix/validator'
import { MAX_LOOKUP_EMAIL_LENGTH } from 'utils/constants.ts'

/**
 * Whether `value` is an email address for the administrator's lookup: a string that, without its
 * surrounding whitespace (the lookup trims it), has at most {@linkcode MAX_LOOKUP_EMAIL_LENGTH}
 * characters and is a valid address by the same native check `IsEmail` applies.
 */
export function isLookupEmail(value?: string): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return stringLength(trimmed, 1, MAX_LOOKUP_EMAIL_LENGTH) && isEmail(trimmed)
}

/**
 * Decorator to validate the `email` of the exact account lookup. It differs from `IsEmail` in two
 * ways only: it ignores surrounding whitespace, and it bounds the length.
 *
 * @param options Optional validation settings, including a custom error message.
 */
export function IsLookupEmail(
  options: Parameters<typeof defineValidationDecorator>[1] = {},
): ReturnType<typeof defineValidationDecorator> {
  return defineValidationDecorator(isLookupEmail, {
    message: (property: string) =>
      `The '${property}' property must be a valid email address of at most ` +
      `${MAX_LOOKUP_EMAIL_LENGTH} characters.`,
    ...options,
  })
}
