import { assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PasswordToggleField } from 'ui/components/password-toggle-field/index.ts'

// Same real-DOM harness `components/cookie-consent-modal.test.ts` already establishes — this
// component's whole point (a real `useState` toggling the underlying `<input>`'s own `type`
// attribute on a real click) can't be verified from static SSR markup alone, which never dispatches
// a real click event at all.
function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount: () => act(() => root.unmount()),
  }
}

Deno.test('PasswordToggleField: clicking the toggle button flips the real input from type="password" to type="text"', () => {
  const { container, unmount } = mount(
    createElement(PasswordToggleField, {
      name: 'password',
      autoComplete: 'current-password',
      showLabel: 'Show password',
      hideLabel: 'Hide password',
    }),
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
