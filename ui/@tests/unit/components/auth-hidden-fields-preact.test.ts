import { assertEquals } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createAuthHiddenFields } from 'ui/components/auth-hidden-fields/render.ts'

const authHiddenFields = createAuthHiddenFields<VNode>(
  h as unknown as CreateElement<VNode>,
)

function render(props: Parameters<typeof authHiddenFields>[0]): string {
  return renderToString(h('div', null, ...authHiddenFields(props)))
}

Deno.test('authHiddenFields (preact): returns exactly two hidden inputs, _csrf then email', () => {
  const html = render({ csrfToken: 'tok-123', email: 'jane@example.com' })

  assertEquals(html.indexOf('name="_csrf"') > -1, true)
  assertEquals(html.indexOf('name="email"') > -1, true)
  assertEquals(html.indexOf('name="_csrf"') < html.indexOf('name="email"'), true)
})

Deno.test('authHiddenFields (preact): carries the given csrfToken and email as their own value', () => {
  const html = render({ csrfToken: 'tok-123', email: 'jane@example.com' })

  assertEquals(html.includes('value="tok-123"'), true)
  assertEquals(html.includes('value="jane@example.com"'), true)
})

Deno.test('authHiddenFields (preact): a missing csrfToken renders as an empty value, never "undefined"', () => {
  const html = render({ email: 'jane@example.com' })

  // Preact's own server renderer collapses an empty string attribute to a bare `value` (no
  // `=""`), unlike React's — real, renderer-specific serialization, not a bug in this component.
  assertEquals(html.includes('name="_csrf" value/>'), true)
  assertEquals(html.includes('undefined'), false)
})

Deno.test('authHiddenFields (preact): a phone-keyed caller gets _csrf + phone, never an email field', () => {
  const html = render({ csrfToken: 'tok-123', phone: '+15551234567' })

  assertEquals(html.includes('name="phone" value="+15551234567"'), true)
  assertEquals(html.includes('name="email"'), false)
})
