import { assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RateLimitCountdown } from 'ui/pages/login/rate-limit-countdown/index.ts'

// Same real-DOM harness `password-toggle-field.test.ts` already establishes — this component's
// whole point (a live wall-clock tick, and re-enabling the surrounding form once it reaches zero)
// can't be verified from static SSR markup alone, which never runs a mount effect or advances real
// time at all.
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

/** Builds the exact sibling shape `login/render.ts` actually renders — a `<form id={formId}>`
 * with disabled fields, and a separate card element (`[data-space={cardDataSpace}]`) that's where
 * this Comet itself mounts — so `onComplete`'s own `document.getElementById`/`querySelector`
 * calls exercise the real, cross-boundary DOM shape, not a convenient stand-in. */
function buildFormFixture(formId: string) {
  const form = document.createElement('form')
  form.id = formId
  const input = document.createElement('input')
  input.disabled = true
  const button = document.createElement('button')
  button.type = 'submit'
  button.disabled = true
  form.append(input, button)
  document.body.appendChild(form)
  return { form, input, button }
}

Deno.test('RateLimitCountdown: re-enables every disabled field in the form once the countdown reaches zero', async () => {
  const formId = 'rate-limit-test-form'
  const cardDataSpace = 'rate-limit-test-card'
  const { input, button, form } = buildFormFixture(formId)

  const card = document.createElement('div')
  card.setAttribute('data-space', cardDataSpace)
  document.body.appendChild(card)

  // Mounted into its own fresh container, not nested inside `card` — `onComplete`'s own
  // `document.getElementById`/`querySelector` calls are global-document lookups (the whole point:
  // this Comet reaches OUTSIDE its own root — see `render.ts`'s own doc), so where it mounts
  // relative to `form`/`card` doesn't matter for what this test verifies.
  const { unmount } = mount(
    createElement(RateLimitCountdown, {
      target: Date.now() + 300,
      size: 72,
      strokeWidth: 5,
      formId,
      cardDataSpace,
    }),
  )
  assertEquals(input.disabled, true)
  assertEquals(button.disabled, true)

  // `Countdown`'s own tick interval (`TICK_INTERVAL_MS`, 250ms) — real wall-clock time, no fake
  // timers in this harness (see `dom-test-setup.ts`'s own doc). 300ms target + one extra tick of
  // slack is enough for the real interval to fire past zero without flaking on CI jitter.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
  })

  assertEquals(input.disabled, false)
  assertEquals(button.disabled, false)
  assertEquals(document.getElementById(formId), form)
  assertEquals(document.querySelector(`[data-space='${cardDataSpace}']`), null)

  unmount()
})
