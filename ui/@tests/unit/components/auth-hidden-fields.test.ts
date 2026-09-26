import { assertEquals } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createAuthHiddenFields } from 'ui/components/auth-hidden-fields/render.ts'

/**
 * `authHiddenFields`'s own factory — a plain function returning `E[]`, never a component (see
 * `render.ts`'s own doc). Exercised by rendering its two returned elements inside a wrapping
 * `<div>`, the same "test the raw factory in isolation" convention `rate-limit-card.test.ts`
 * establishes for a real composed component elsewhere in this package.
 */

const authHiddenFields = createAuthHiddenFields<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
)

function render(props: Parameters<typeof authHiddenFields>[0]): string {
  return renderToStaticMarkup(createElement('div', null, ...authHiddenFields(props)))
}

Deno.test('authHiddenFields: returns exactly two hidden inputs, _csrf then email', () => {
  const html = render({ csrfToken: 'tok-123', email: 'jane@example.com' })

  assertEquals(html.indexOf('name="_csrf"') > -1, true)
  assertEquals(html.indexOf('name="email"') > -1, true)
  assertEquals(html.indexOf('name="_csrf"') < html.indexOf('name="email"'), true)
})

Deno.test('authHiddenFields: carries the given csrfToken and email as their own value', () => {
  const html = render({ csrfToken: 'tok-123', email: 'jane@example.com' })

  assertEquals(html.includes('name="_csrf" value="tok-123"'), true)
  assertEquals(html.includes('name="email" value="jane@example.com"'), true)
})

Deno.test('authHiddenFields: both inputs are type=hidden', () => {
  const html = render({ csrfToken: 'tok-123', email: 'jane@example.com' })

  const matches = html.match(/type="hidden"/g)
  assertEquals(matches?.length, 2)
})

Deno.test('authHiddenFields: a missing csrfToken renders as an empty value, never "undefined"', () => {
  const html = render({ email: 'jane@example.com' })

  assertEquals(html.includes('name="_csrf" value=""'), true)
})

Deno.test('authHiddenFields: a phone-keyed caller gets _csrf + phone, never an email field', () => {
  const html = render({ csrfToken: 'tok-123', phone: '+15551234567' })

  assertEquals(html.includes('name="_csrf" value="tok-123"'), true)
  assertEquals(html.includes('name="phone" value="+15551234567"'), true)
  assertEquals(html.includes('name="email"'), false)
})

Deno.test('authHiddenFields: neither email nor phone given renders only _csrf', () => {
  const html = render({ csrfToken: 'tok-123' })

  const matches = html.match(/type="hidden"/g)
  assertEquals(matches?.length, 1)
})
