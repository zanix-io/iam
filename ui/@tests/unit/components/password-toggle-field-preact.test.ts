import { assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { h, render as renderDOM } from 'preact'
import type { VNode } from 'preact'
import { act } from 'preact/test-utils'
import { render as renderToString } from 'preact-render-to-string'
import { PasswordToggleField } from 'ui/components/password-toggle-field/index.preact.ts'

// Same real-DOM harness `password-toggle-field.test.ts` (the React binding) already establishes,
// verified independently against the Preact one — this component's whole point (a real `useState`
// toggling the underlying `<input>`'s own `type` attribute on a real click) can't be verified from
// static SSR markup alone, which never dispatches a real click event at all, and
// `login-preact.test.ts`'s own composition test only ever renders static markup too.
function mount(element: VNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => renderDOM(element, container))
  return {
    container,
    unmount: () => act(() => renderDOM(null, container)),
  }
}

Deno.test('PasswordToggleField (preact): clicking the toggle button flips the real input from type="password" to type="text"', () => {
  const { container, unmount } = mount(
    h(PasswordToggleField, {
      name: 'password',
      autoComplete: 'current-password',
      showLabel: 'Show password',
      hideLabel: 'Hide password',
    }) as VNode,
  )

  const input = container.querySelector('input')
  assertEquals(input?.getAttribute('type'), 'password')

  const toggleButton = container.querySelector('button')
  act(() => {
    toggleButton?.dispatchEvent(new Event('click', { bubbles: true }))
  })

  assertEquals(input?.getAttribute('type'), 'text')
  assertEquals(toggleButton?.getAttribute('aria-label'), 'Hide password')

  unmount()
})

// --- Real wiring — the actual `index.preact.ts` binding, including the real defineComet boundary -

Deno.test('PasswordToggleField (index.preact.ts): the real binding constructs without throwing', () => {
  const html = renderToString(
    h(PasswordToggleField, {
      name: 'password',
      autoComplete: 'current-password',
      showLabel: 'Show password',
      hideLabel: 'Hide password',
    }) as VNode,
  )
  assertEquals(typeof html, 'string')
  assertEquals(html.length > 0, true)
})
