import { defineValidationDecorator } from '@zanix/validator'

/** Whether `value` is an array of at most `max` elements; empty is fine. */
export function hasAtMostItems(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max
}

/**
 * Decorator to validate that an array has at most `max` elements, an empty one included.
 * `ArrayLength` cannot express this: its minimum is at least 1, so it always rejects `[]`.
 *
 * @param max The most elements allowed.
 * @param options Optional validation settings, including a custom error message.
 */
export function MaxItems(
  max: number,
  options: Parameters<typeof defineValidationDecorator>[1] = {},
): ReturnType<typeof defineValidationDecorator> {
  return defineValidationDecorator((value) => hasAtMostItems(value, max), {
    message: (property: string) => `'${property}' must have at most ${max} elements.`,
    ...options,
  })
}
