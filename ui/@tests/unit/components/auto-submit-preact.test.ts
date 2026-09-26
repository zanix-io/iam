import { assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { h, render as renderDOM } from 'preact'
import type { VNode } from 'preact'
import { act } from 'preact/test-utils'
import { AutoSubmit } from 'ui/components/auto-submit/index.preact.ts'

// Same real-DOM harness `auto-submit.test.ts` (the React binding) already establishes, verified
// independently against the Preact one — this Comet's whole point (a real `requestSubmit()` call
// on mount) can't be verified from static SSR markup alone, which never runs a mount effect at
// all, and neither `login-oauth-start.test.ts` nor `login-oauth-start-preact.test.ts` exercises
// the real component (both stub `AutoSubmit` as `() => null`) — this file is the ONLY real
// coverage of the Preact binding's actual behavior.
function mount(element: VNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => renderDOM(element, container))
  return {
    unmount: () => act(() => renderDOM(null, container)),
  }
}

Deno.test('AutoSubmit (preact): submits the target form exactly once on mount', () => {
  const formId = 'auto-submit-preact-test-form'
  const form = document.createElement('form')
  form.id = formId
  const button = document.createElement('button')
  button.type = 'submit'
  form.append(button)
  document.body.appendChild(form)

  let submitCount = 0
  form.addEventListener('submit', (event) => {
    submitCount++
    // happy-dom would otherwise attempt a real navigation this test harness has no server for.
    event.preventDefault()
  })

  const { unmount } = mount(h(AutoSubmit, { formId }) as VNode)

  assertEquals(submitCount, 1)
  assertEquals(button.disabled, false)

  unmount()
  form.remove()
})

Deno.test('AutoSubmit (preact): does nothing when the target formId does not exist — never throws', () => {
  const { unmount } = mount(h(AutoSubmit, { formId: 'no-such-form' }) as VNode)
  unmount()
})

Deno.test('AutoSubmit (preact): a real SubmitGuard on the same form still sees and reacts to the auto-submit', async () => {
  const { attachSubmitGuard } = await import('@zanix/space/comet')
  const formId = 'auto-submit-guard-preact-test-form'
  const form = document.createElement('form')
  form.id = formId
  const button = document.createElement('button')
  button.type = 'submit'
  form.append(button)
  document.body.appendChild(form)

  let submitCount = 0
  form.addEventListener('submit', (event) => {
    submitCount++
    event.preventDefault()
  })

  const detachGuard = attachSubmitGuard({ formId })
  const { unmount } = mount(h(AutoSubmit, { formId }) as VNode)

  // `SubmitGuard`'s own handler runs on the SAME real `submit` event `requestSubmit()` dispatches
  // — same real, documented reason `attach.ts` chose `requestSubmit()` over `.submit()`, now
  // confirmed for the Preact binding too, not just the React one.
  assertEquals(submitCount, 1)
  assertEquals(button.disabled, true)

  unmount()
  detachGuard()
  form.remove()
})
