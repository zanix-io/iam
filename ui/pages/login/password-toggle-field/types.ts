import type { PasswordInputBaseProps } from '@zanix/space-ui'

/**
 * Props for the login page's password visibility-toggle Comet (`index.ts`/`index.preact.ts`) —
 * {@linkcode PasswordInputBaseProps} minus `getToggleLabel`/`onVisibleChange` (both functions,
 * which can't cross a Comet's own JSON-only prop boundary — `@zanix/space`'s own `defineComet`
 * doc, "a Comet's own props cross the server/client boundary as plain JSON"), plus the two
 * already-resolved accessible-name strings `getToggleLabel` would otherwise compute. See
 * `render.ts`'s own doc for the full contract.
 */
export type PasswordToggleFieldProps =
  & Omit<
    PasswordInputBaseProps,
    'getToggleLabel' | 'onVisibleChange'
  >
  & {
    /** Toggle button's accessible name while the field is masked (`type="password"`) — the label
     * shown BEFORE a click reveals it. */
    showLabel: string
    /** Toggle button's accessible name while the field is revealed (`type="text"`) — the label
     * shown BEFORE a click re-masks it. */
    hideLabel: string
  }
