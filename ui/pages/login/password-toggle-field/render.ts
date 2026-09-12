import type { CreateElement } from 'ui/typings/renderer.ts'
import type { PasswordToggleFieldProps } from './types.ts'

/** The renderer's own already-built `PasswordInput` (`@zanix/space-ui` for React,
 * `@zanix/space-ui/preact` for Preact) this Comet wraps unmodified, injected the same way
 * `login/render.ts`'s own `LoginViewDeps` injects every `@zanix/space-ui` component it uses —
 * `index.ts`/`index.preact.ts` each supply their own renderer's real copy. */
export type PasswordToggleFieldDeps<E> = {
  PasswordInput: (props: Record<string, unknown>) => E
}

/**
 * The real, renderer-neutral implementation `index.ts`/`index.preact.ts` each wrap in
 * `defineComet` — composes the unmodified `PasswordInput` (`@zanix/space-ui`), the same
 * "composed, not reimplemented" rule `PasswordInput` itself already follows for `Input`/`Button`
 * (`@zanix/space-ui`'s own `PasswordInput/render.ts` doc); this file adds no toggle logic of its
 * own, only a Comet-safe prop shape.
 *
 * ## Why this needed its own Comet at all
 *
 * `login/render.ts` renders the password field as plain server HTML, outside any Comet boundary —
 * `ManagedForm` (this page's one other Comet) is a sibling of the `<form>`, not a wrapper around
 * it, so it hydrates nothing inside the form. `PasswordInput`'s own show/hide toggle button relies
 * on a real `useState` to flip the underlying `<input>`'s `type` — with no hydration boundary of
 * its own, that `useState` never ran client-side at all, so the toggle button rendered correctly
 * but never responded to a click. Wrapping `PasswordInput`'s existing usage in a Comet (rather than
 * reimplementing the toggle) fixes exactly that, with no change to `PasswordInput` itself.
 *
 * ## The one real adaptation: `getToggleLabel` → `showLabel`/`hideLabel`
 *
 * `PasswordInput.getToggleLabel` is a FUNCTION prop (`(visible: boolean) => string`), which can't
 * cross a Comet's own JSON-only prop boundary. `showLabel`/`hideLabel` carry the SAME two
 * already-resolved accessible-name strings instead (`login/render.ts`'s own `formatMessage` calls,
 * run server-side before this Comet's props are serialized) — `getToggleLabel` is reconstructed as
 * a plain closure INSIDE this component's own body, never passed across the boundary itself. The
 * real `<input>` stays server-rendered exactly as before: this Comet changes nothing about what
 * `PasswordInput` renders, only how its props reach it.
 */
export function createPasswordToggleField<E>(
  h: CreateElement<E>,
  { PasswordInput }: PasswordToggleFieldDeps<E>,
): (props: PasswordToggleFieldProps) => E {
  return function PasswordToggleField(props: PasswordToggleFieldProps): E {
    const { showLabel, hideLabel, ...inputProps } = props
    return h(PasswordInput, {
      ...inputProps,
      getToggleLabel: (visible: boolean) => (visible ? hideLabel : showLabel),
    })
  }
}
