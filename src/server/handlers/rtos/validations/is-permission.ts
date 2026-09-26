import { defineValidationDecorator } from '@zanix/validator'
import { PERMISSION_REGEX } from 'utils/constants.ts'

/** Whether `value` matches this project's own `module:action` permission-code shape. */
export function isPermission(value?: string): boolean {
  return typeof value === 'string' && PERMISSION_REGEX.test(value)
}

/**
 * Decorator to validate that a field is a permission code in this project's own `module:action`
 * shape (letters and hyphens only on each side of the colon) — the shape every `RBAC_PERMISSIONS`
 * value and `roles`/`permissions` catalog `code` is expected to follow.
 *
 * `@zanix/validator` ships no built-in equivalent — hand-written here via the package's own public `defineValidationDecorator`, the same extension
 * point its own JSDoc documents for a fully custom decorator. The options/return types below are
 * derived from `defineValidationDecorator`'s own signature (`Parameters`/`ReturnType`) rather than
 * imported by name, since `@zanix/validator`'s `mod.ts` doesn't re-export `ValidationOptions`/
 * `ValidationDecoratorDefinition` themselves.
 *
 * @param options Optional validation settings, including a custom error message.
 */
export function IsPermission(
  options: Parameters<typeof defineValidationDecorator>[1] = {},
): ReturnType<typeof defineValidationDecorator> {
  return defineValidationDecorator(isPermission, {
    message: (property: string) =>
      `The '${property}' property must be a valid permission code in the 'module:action' format ` +
      '(letters and hyphens only).',
    ...options,
  })
}
