import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createPhoneConfirmView } from 'ui/pages/phone-confirm/render.ts'
import type { PhoneConfirmViewProps } from 'ui/pages/phone-confirm/types.ts'
import { IAM_UI_MESSAGES_EN } from '../../../sdk/messages/en.ts'

const BASE_PROPS: PhoneConfirmViewProps = {
  lang: 'en',
  phone: '+14155551234',
  invalidCode: false,
}

// `SubmitGuard` is exercised for real only by the binding test at the bottom; the content tests
// use a `null`-rendering stand-in (same approach as `phone-enroll.test.ts`).
const PhoneConfirmViewForContent = createPhoneConfirmView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null },
)

function render(props: PhoneConfirmViewProps, View = PhoneConfirmViewForContent): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: IAM_UI_MESSAGES_EN },
      createElement(View, props),
    ),
  )
}

Deno.test('PhoneConfirmView: renders the heading, the phone the code went to, and a code field', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, `<h1>${IAM_UI_MESSAGES_EN['phone/confirm/heading']}</h1>`)
  assertStringIncludes(html, 'We sent a code to +14155551234.')
  assertStringIncludes(html, 'name="code"')
  assertStringIncludes(html, 'method="post"')
})

Deno.test('PhoneConfirmView: carries the phone and the CSRF token as hidden fields', () => {
  const html = render({ ...BASE_PROPS, csrfToken: 'the-token' })
  assertStringIncludes(html, 'name="phone" value="+14155551234"')
  assertStringIncludes(html, 'name="_csrf" value="the-token"')
})

Deno.test('PhoneConfirmView: a missing CSRF token renders an empty hidden value, never "undefined"', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, 'name="_csrf" value=""')
  assertEquals(html.includes('undefined'), false)
})

Deno.test('PhoneConfirmView: renders the invalid-code banner only when invalidCode is true', () => {
  const banner = 'data-space="banner" data-variant="error"'
  assertStringIncludes(render({ ...BASE_PROPS, invalidCode: true }), banner)
  assertEquals(render(BASE_PROPS).includes(banner), false)
})

Deno.test('PhoneConfirmView: flattens every constraint of the code field error', () => {
  const html = render({
    ...BASE_PROPS,
    fieldErrors: { code: [{ constraints: ['Required.'] }, { constraints: ['Must be 6 digits.'] }] },
  })
  assertStringIncludes(html, 'Required.')
  assertStringIncludes(html, 'Must be 6 digits.')
})

Deno.test('PhoneConfirmView: a code error entry with no constraints renders no error text', () => {
  const withEmpty = render({ ...BASE_PROPS, fieldErrors: { code: [{}] } })
  assertEquals(withEmpty, render(BASE_PROPS))
})

Deno.test('PhoneConfirmView (index.ts): the real binding renders without throwing, SubmitGuard included', async () => {
  await import('@zanix/space/react')
  const { PhoneConfirmView } = await import('ui/pages/phone-confirm/index.ts')
  assertStringIncludes(render(BASE_PROPS, PhoneConfirmView), 'We sent a code to +14155551234.')
})
