import type { CreateElement } from 'ui/typings/renderer.ts'
import type { OtpCodeFieldProps } from './types.ts'

/** The subset of `useState` this component's shared body needs, injected alongside `h` — same
 * `render.ts`-factory technique `login/render.ts`'s own `LoginViewDeps` establishes for every
 * other shared, stateful view/Comet in this package. */
export type OtpCodeFieldHooks = {
  useState: <T>(initial: T) => [T, (value: T) => void]
}

/** The `@zanix/space-ui` `Input` this Comet composes unmodified — `index.ts`/`index.preact.ts`
 * each supply their own renderer's real, already-bound copy (`@zanix/space-ui`'s root barrel for
 * React, `/preact` for Preact). Passed through `h` as a component REFERENCE (`h(Input, props)`),
 * never called directly — it calls a real hook internally (`useState`); see
 * {@linkcode CreateElement}'s own doc for why that distinction is load-bearing. */
export type OtpCodeFieldDeps<E> = {
  Input: (props: Record<string, unknown>) => E
}

/**
 * The real, renderer-neutral implementation `index.ts`/`index.preact.ts` each wrap in
 * `defineComet` — a six-box verification-code field shared by every screen that collects one
 * (email/SMS/WhatsApp OTP login, a TOTP authenticator code, any other code challenge):
 * one real, accessible text input wearing a six-box costume, not six independent inputs.
 *
 * A shared component (`ui/components/`), not private to any one page — the exact same reasoning
 * `ui/components/password-toggle-field`'s own doc already establishes: any real code-entry field
 * anywhere (`iam`'s own or a consumer's) needs the identical mechanism, so this lives promoted
 * rather than duplicated per caller. It relies on `@zanix/space-ui`'s `Input` props
 * `inputMode`/`onPaste`/`autoFocus` — `autoFocus`, not a `ref` prop, handles "focus on mount",
 * since Preact core has no ref-forwarding for a plain function component.
 *
 * ## Why one real `<input>`, not six
 *
 * `autocomplete="one-time-code"` and `inputMode="numeric"` need to live on ONE logical input for a
 * mobile browser's own SMS/mail autofill affordance and a screen reader to treat this as a single
 * field, not a fragmented group of six. The six visible boxes rendered below are a purely
 * decorative, `aria-hidden` mirror of that one real input's current value — never separate
 * focusable elements, so there is no roving-tabindex/per-box-paste logic to get wrong. The real
 * input stays visually present but text-transparent (a host's own CSS targets
 * `data-space='otp-code-field-real-input'`; this package ships no styling of its own for it,
 * same "brand/theme is the host's job" rule `LoginView`'s own `mode='passwordless'` OAuth buttons
 * follow), so the native caret
 * still shows exactly where typing lands.
 *
 * ## Auto-submit
 *
 * `requestSubmit()` (never a raw `.submit()`, which would skip the form's own `action`/validation
 * wiring and any other `submit` listener) fires once `length` digits are present, inside a
 * `requestAnimationFrame` so the input's own value commits to the DOM (and this component's own
 * render reflecting it) before the form reads its fields. A rejected code comes back as a fresh
 * server-rendered page with `initialError` set — this Comet doesn't handle the rejection itself,
 * it just re-mounts already showing it.
 *
 * ## The one real adaptation: paste REPLACES, never inserts
 *
 * A native paste at a non-empty cursor position would INSERT into the existing value — bad UX
 * for a code field (a visitor who typed 2 digits, then pastes the full 6-digit code, would get a
 * garbled 8-character value). `onPaste` intercepts and calls `commit` with ONLY the pasted text
 * instead, discarding whatever was already typed.
 */
export function createOtpCodeField<E>(
  h: CreateElement<E>,
  hooks: OtpCodeFieldHooks,
  deps: OtpCodeFieldDeps<E>,
): (props: OtpCodeFieldProps) => E {
  const { Input } = deps

  return function OtpCodeField(
    { name, length, formId, initialError, ariaLabel, disabled }: OtpCodeFieldProps,
  ): E {
    const [value, setValue] = hooks.useState('')
    const [errorFlash, setErrorFlash] = hooks.useState(Boolean(initialError))

    const commit = (raw: string) => {
      const clean = raw.replace(/\D/g, '').slice(0, length)
      setValue(clean)
      if (errorFlash) setErrorFlash(false)
      if (clean.length === length) {
        requestAnimationFrame(() => {
          const form = document.getElementById(formId) as HTMLFormElement | null
          form?.requestSubmit()
        })
      }
    }

    const digits = Array.from({ length }, (_, i) => value[i] ?? '')
    // The box that gets the "active" ring: the next empty one, or the last box once full (so the
    // completed state still shows a ring rather than none at all right before auto-submit fires).
    const activeIndex = value.length < length ? value.length : length - 1

    return h(
      'div',
      { 'data-space': 'otp-code-field', 'data-disabled': disabled },
      h(Input, {
        id: `${formId}-${name}`,
        name,
        type: 'text',
        inputMode: 'numeric',
        autoComplete: 'one-time-code',
        pattern: '[0-9]*',
        maxLength: length,
        value,
        autoFocus: true,
        disabled,
        'aria-label': ariaLabel,
        className: 'otp-code-field-real-input',
        onValueChange: commit,
        onPaste: (event: ClipboardEvent) => {
          const pasted = event.clipboardData?.getData('text') ?? ''
          if (!pasted) return
          event.preventDefault()
          commit(pasted)
        },
      }),
      h(
        'div',
        { 'data-space': 'otp-code-field-boxes', 'aria-hidden': 'true' },
        ...digits.map((digit, index) =>
          h(
            'span',
            {
              key: index,
              'data-space': 'otp-code-field-box',
              'data-active': index === activeIndex,
              'data-error': errorFlash,
            },
            digit,
          )
        ),
      ),
    )
  }
}
