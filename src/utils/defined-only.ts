/** `fields` without the keys whose value is `undefined`, so an update never writes them. */
export function definedOnly<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
