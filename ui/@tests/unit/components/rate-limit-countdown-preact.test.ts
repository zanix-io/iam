import { assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { h, render as renderDOM } from 'preact'
import type { VNode } from 'preact'
import { act } from 'preact/test-utils'
import { render as renderToString } from 'preact-render-to-string'
import { RateLimitCountdown } from 'ui/components/rate-limit-countdown/index.preact.ts'

// Same real-DOM harness `rate-limit-countdown.test.ts` (the React binding) already establishes,
// verified independently against the Preact one — this pair is what actually proves this
// component's whole point (a live wall-clock tick, and re-enabling the surrounding form once it
// reaches zero) behaves identically regardless of which renderer it's bound to. Neither the React
// sibling's own real-DOM assertions nor `login-preact.test.ts`'s own static
// `preact-render-to-string` markup check exercises this — a real mount effect and real elapsed
// time never run under static SSR markup at all.
function mount(element: VNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => renderDOM(element, container))
  return {
    container,
    unmount: () => act(() => renderDOM(null, container)),
  }
}

/** Builds the exact sibling shape `login/render.ts` actually renders — a `<form id={formId}>`
 * with disabled fields, and a separate card element (`[data-space={cardDataSpace}]`) that's where
 * this Comet itself mounts — same fixture `rate-limit-countdown.test.ts`'s own React sibling
 * builds, so both prove the identical cross-boundary DOM contract. */
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

Deno.test('RateLimitCountdown (preact): re-enables every disabled field in the form once the countdown reaches zero', async () => {
  const formId = 'rate-limit-preact-test-form'
  const cardDataSpace = 'rate-limit-preact-test-card'
  const { input, button, form } = buildFormFixture(formId)

  const card = document.createElement('div')
  card.setAttribute('data-space', cardDataSpace)
  document.body.appendChild(card)

  const { unmount } = mount(
    h(RateLimitCountdown, {
      target: Date.now() + 300,
      size: 72,
      strokeWidth: 5,
      formId,
      cardDataSpace,
    }) as VNode,
  )
  assertEquals(input.disabled, true)
  assertEquals(button.disabled, true)

  // Same real wall-clock slack `rate-limit-countdown.test.ts`'s own React sibling uses — no fake
  // timers in this harness (see `dom-test-setup.ts`'s own doc).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
  })

  assertEquals(input.disabled, false)
  assertEquals(button.disabled, false)
  assertEquals(document.getElementById(formId), form)
  assertEquals(document.querySelector(`[data-space='${cardDataSpace}']`), null)

  unmount()
})

Deno.test('RateLimitCountdown (preact): removes the named query params from the URL once the countdown reaches zero', async () => {
  const formId = 'rate-limit-preact-test-form-2'
  const cardDataSpace = 'rate-limit-preact-test-card-2'
  buildFormFixture(formId)
  const card = document.createElement('div')
  card.setAttribute('data-space', cardDataSpace)
  document.body.appendChild(card)

  history.replaceState(
    null,
    '',
    '/en/login?error=rate_limited&retryUntil=123&redirect_to=%2Fprofile',
  )

  const { unmount } = mount(
    h(RateLimitCountdown, {
      target: Date.now() + 300,
      size: 72,
      strokeWidth: 5,
      formId,
      cardDataSpace,
      clearQueryParamsOnComplete: ['error', 'retryUntil'],
    }) as VNode,
  )

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
  })

  const url = new URL(location.href)
  assertEquals(url.searchParams.has('error'), false)
  assertEquals(url.searchParams.has('retryUntil'), false)
  assertEquals(url.searchParams.get('redirect_to'), '/profile')

  unmount()
})

// --- Real wiring — the actual `index.preact.ts` binding, including the real defineComet boundary -

Deno.test('RateLimitCountdown (index.preact.ts): the real binding constructs without throwing', () => {
  const html = renderToString(
    h(RateLimitCountdown, {
      target: Date.now() + 60_000,
      size: 72,
      strokeWidth: 5,
      formId: 'ssr-form',
      cardDataSpace: 'ssr-card',
    }) as VNode,
  )
  assertEquals(typeof html, 'string')
  assertEquals(html.length > 0, true)
})
