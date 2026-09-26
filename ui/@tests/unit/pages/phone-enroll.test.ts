import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.ts'
import { createPhoneEnrollView } from 'ui/pages/phone-enroll/render.ts'
import type { PhoneEnrollViewProps } from 'ui/pages/phone-enroll/types.ts'

const TEST_MESSAGES = {
  'phone/enroll/heading': 'Verify your phone number',
  'phone/enroll/body': "We'll text you a code.",
  'common/invalid-or-expired-code': 'That code is invalid or expired.',
  'phone/enroll/phone-label': 'Phone number',
  'phone/enroll/phone-placeholder': '+1 555 123 4567',
  'phone/enroll/submit': 'Send code',
}

const BASE_PROPS: PhoneEnrollViewProps = {
  lang: 'en',
  invalidCode: false,
}

// `SubmitGuard` is exercised for real only by the dedicated wiring test at the bottom — see
// `login.test.ts`'s own identical doc for why every other test here uses a `null`-rendering
// stand-in instead.
const PhoneEnrollViewForContent = createPhoneEnrollView<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null, authHiddenFields },
)

function render(props: PhoneEnrollViewProps): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      createElement(PhoneEnrollViewForContent, props),
    ),
  )
}

Deno.test('PhoneEnrollView: renders the heading and a phone field', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, '<h1>Verify your phone number</h1>')
  assertStringIncludes(html, 'name="phone"')
})

Deno.test('PhoneEnrollView: renders the invalid-code banner only when invalidCode is true', () => {
  const html = render({ ...BASE_PROPS, invalidCode: true })
  assertStringIncludes(html, 'That code is invalid or expired.')
  assertStringIncludes(html, 'data-space="banner" data-variant="error"')
})

Deno.test('PhoneEnrollView: carries the CSRF token via the shared authHiddenFields', () => {
  const html = render({ ...BASE_PROPS, csrfToken: 'the-token' })
  assertStringIncludes(html, 'value="the-token"')
})

Deno.test('PhoneEnrollView (index.ts): the real binding renders without throwing, SubmitGuard included', async () => {
  await import('@zanix/space/react')
  const { PhoneEnrollView } = await import('ui/pages/phone-enroll/index.ts')
  const element = createElement(PhoneEnrollView, { lang: 'en', invalidCode: false })
  const markup = renderToStaticMarkup(
    createElement(IntlProvider, { locale: 'en', messages: TEST_MESSAGES }, element),
  )
  assertStringIncludes(markup, 'Verify your phone number')
})

Deno.test('PhoneEnrollView: a phone error entry with no constraints renders no error text', () => {
  assertEquals(render({ ...BASE_PROPS, fieldErrors: { phone: [{}] } }), render(BASE_PROPS))
})

Deno.test('PhoneEnrollView: field errors for other fields never render as a phone error', () => {
  assertEquals(render({ ...BASE_PROPS, fieldErrors: {} }), render(BASE_PROPS))
})
