import { assertEquals } from 'jsr:@std/assert@0.224'
import { must } from '../dom-test-setup.ts'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRateLimitCard } from 'ui/components/rate-limit-card/render.ts'

/**
 * Same behavior as `rate-limit-card.test.ts` (the React binding), verified independently against
 * the Preact one — `RateLimitCard`'s own factory exercised directly against a stub
 * `RateLimitCountdown` (never the real Comet), matching that file's own "test the raw factory in
 * isolation" convention exactly (the React sibling never tests the real `index.ts` binding's own
 * Comet-in-Comet composition either — see its own doc for why: `login.test.ts`'s dedicated wiring
 * test already covers that, for React specifically. There's no Preact equivalent possible here: a
 * Comet's active-renderer flag is only ever set by `defineSpaceApp({ renderer }).setup()` at real
 * app bootstrap, never by importing `@zanix/space/preact` alone — see `active-renderer.ts`'s own
 * doc in `@zanix/space` — so a plain unit test can exercise a REAL Preact Comet-in-Comet boundary
 * no more than `login-preact.test.ts`'s own doc already says it deliberately doesn't attempt to).
 */

function stubCountdown(props: Record<string, unknown>): VNode {
  return h('div', { 'data-testid': 'stub-countdown', 'data-props': JSON.stringify(props) }) as VNode
}

const RateLimitCard = createRateLimitCard<VNode>(
  h as unknown as CreateElement<VNode>,
  { RateLimitCountdown: stubCountdown },
)

const BASE_PROPS = {
  target: 1_700_000_000_000,
  size: 72,
  strokeWidth: 5,
  formId: 'test-form',
  cardDataSpace: 'test-rate-limit-card',
  headingLabel: 'For your security, we paused sign-in attempts for a moment.',
  bodyLabel: 'You can try again in:',
}

Deno.test('RateLimitCard (preact): renders the heading and body BEFORE the countdown', () => {
  const html = renderToString(h(RateLimitCard, BASE_PROPS) as VNode)

  const headingIndex = html.indexOf('login-rate-limit-heading')
  const bodyIndex = html.indexOf('login-rate-limit-body')
  const countdownIndex = html.indexOf('stub-countdown')

  assertEquals(headingIndex > -1 && bodyIndex > -1 && countdownIndex > -1, true)
  assertEquals(headingIndex < bodyIndex, true)
  assertEquals(bodyIndex < countdownIndex, true)
})

Deno.test('RateLimitCard (preact): the root carries cardDataSpace and role=status', () => {
  const html = renderToString(h(RateLimitCard, BASE_PROPS) as VNode)

  assertEquals(html.includes('data-space="test-rate-limit-card"'), true)
  assertEquals(html.includes('role="status"'), true)
})

Deno.test('RateLimitCard (preact): forwards every countdown-relevant prop to the composed RateLimitCountdown, never headingLabel/bodyLabel', () => {
  const html = renderToString(
    h(RateLimitCard, {
      ...BASE_PROPS,
      clearQueryParamsOnComplete: ['error', 'retryUntil'],
      nonce: 'abc123',
    }) as VNode,
  )

  const match = must(html.match(/data-props="([^"]+)"/))
  const forwarded = JSON.parse(match[1].replace(/&quot;/g, '"'))

  assertEquals(forwarded, {
    target: BASE_PROPS.target,
    size: BASE_PROPS.size,
    strokeWidth: BASE_PROPS.strokeWidth,
    formId: BASE_PROPS.formId,
    cardDataSpace: BASE_PROPS.cardDataSpace,
    clearQueryParamsOnComplete: ['error', 'retryUntil'],
    nonce: 'abc123',
  })
})

Deno.test('RateLimitCard (preact): the two labels render verbatim, never through any i18n mechanism of its own', () => {
  const html = renderToString(
    h(RateLimitCard, {
      ...BASE_PROPS,
      headingLabel: 'Encabezado real',
      bodyLabel: 'Cuerpo real',
    }) as VNode,
  )

  assertEquals(html.includes('Encabezado real'), true)
  assertEquals(html.includes('Cuerpo real'), true)
})
