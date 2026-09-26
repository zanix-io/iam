import { assertEquals } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createRateLimitCard } from 'ui/components/rate-limit-card/render.ts'

/**
 * `RateLimitCard`'s own factory, exercised directly against a stub `RateLimitCountdown` (never the
 * real Comet — this file only proves `RateLimitCard`'s OWN composition: markup order and prop
 * forwarding, the same "test the raw factory in isolation" convention `create-catalog-icon.test.ts`
 * establishes elsewhere in this ecosystem. The real Comet-wrapped integration is already covered by
 * `login.test.ts`'s own dedicated wiring test.
 */

function stubCountdown(props: Record<string, unknown>): ReactElement {
  return createElement('div', {
    'data-testid': 'stub-countdown',
    'data-props': JSON.stringify(props),
  })
}

const RateLimitCard = createRateLimitCard<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
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

Deno.test('RateLimitCard: renders the heading and body BEFORE the countdown', () => {
  const html = renderToStaticMarkup(createElement(RateLimitCard, BASE_PROPS))

  const headingIndex = html.indexOf('login-rate-limit-heading')
  const bodyIndex = html.indexOf('login-rate-limit-body')
  const countdownIndex = html.indexOf('stub-countdown')

  assertEquals(headingIndex > -1 && bodyIndex > -1 && countdownIndex > -1, true)
  assertEquals(headingIndex < bodyIndex, true)
  assertEquals(bodyIndex < countdownIndex, true)
})

Deno.test('RateLimitCard: the root carries cardDataSpace and role=status', () => {
  const html = renderToStaticMarkup(createElement(RateLimitCard, BASE_PROPS))

  assertEquals(html.includes('data-space="test-rate-limit-card"'), true)
  assertEquals(html.includes('role="status"'), true)
})

Deno.test('RateLimitCard: forwards every countdown-relevant prop to the composed RateLimitCountdown, never headingLabel/bodyLabel', () => {
  const html = renderToStaticMarkup(
    createElement(RateLimitCard, {
      ...BASE_PROPS,
      clearQueryParamsOnComplete: ['error', 'retryUntil'],
      nonce: 'abc123',
    }),
  )

  const match = html.match(/data-props="([^"]+)"/)
  if (!match) throw new Error('the comet boundary carries no data-props')
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

Deno.test('RateLimitCard: the two labels render verbatim, never through any i18n mechanism of its own', () => {
  const html = renderToStaticMarkup(
    createElement(RateLimitCard, {
      ...BASE_PROPS,
      headingLabel: 'Encabezado real',
      bodyLabel: 'Cuerpo real',
    }),
  )

  assertEquals(html.includes('Encabezado real'), true)
  assertEquals(html.includes('Cuerpo real'), true)
})
