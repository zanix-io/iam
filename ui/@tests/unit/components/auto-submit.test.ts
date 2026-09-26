import { assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { AutoSubmit } from 'ui/components/auto-submit/index.ts'

// Same real-DOM harness `rate-limit-countdown.test.ts` already establishes — this Comet's whole
// point (a real `requestSubmit()` call on mount) can't be verified from static SSR markup alone,
// which never runs a mount effect at all.
function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    unmount: () => act(() => root.unmount()),
  }
}

Deno.test('AutoSubmit: submits the target form exactly once on mount', () => {
  const formId = 'auto-submit-test-form'
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

  const { unmount } = mount(createElement(AutoSubmit, { formId }))

  assertEquals(submitCount, 1)
  assertEquals(button.disabled, false)

  unmount()
  form.remove()
})

Deno.test('AutoSubmit: does nothing when the target formId does not exist — never throws', () => {
  const { unmount } = mount(createElement(AutoSubmit, { formId: 'no-such-form' }))
  unmount()
})

Deno.test('AutoSubmit: a real SubmitGuard on the same form still sees and reacts to the auto-submit', async () => {
  const { attachSubmitGuard } = await import('@zanix/space/comet')
  const formId = 'auto-submit-guard-test-form'
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
  const { unmount } = mount(createElement(AutoSubmit, { formId }))

  // `SubmitGuard`'s own handler runs on the SAME real `submit` event `requestSubmit()` dispatches
  // — confirms the real, documented reason `attach.ts` chose `requestSubmit()` over `.submit()`
  // here: a plain `.submit()` would never let `SubmitGuard` see this at all.
  assertEquals(submitCount, 1)
  assertEquals(button.disabled, true)

  unmount()
  detachGuard()
  form.remove()
})
