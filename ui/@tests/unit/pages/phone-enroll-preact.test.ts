import { assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, Field, Input, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { authHiddenFields } from 'ui/components/auth-hidden-fields/index.preact.ts'
import { createPhoneEnrollView } from 'ui/pages/phone-enroll/render.ts'
import type { PhoneEnrollViewProps } from 'ui/pages/phone-enroll/types.ts'

const TEST_MESSAGES = {
  'phone/enroll/heading': 'Verify your phone number',
  'phone/enroll/body': "We'll text you a code.",
  'phone/enroll/phone-label': 'Phone number',
  'phone/enroll/phone-placeholder': '+1 555 123 4567',
  'phone/enroll/submit': 'Send code',
}

const BASE_PROPS: PhoneEnrollViewProps = {
  lang: 'en',
  invalidCode: false,
}

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/preact` binding,
// only by a dedicated wiring test elsewhere — see `login.test.ts`'s own identical doc for why (the
// process-wide active-renderer conflict re-testing it per page would otherwise cause).
const PhoneEnrollViewForContent = createPhoneEnrollView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, Field, Input, SubmitGuard: () => null, authHiddenFields },
)

function render(props: PhoneEnrollViewProps): string {
  return renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(PhoneEnrollViewForContent, props),
    ),
  )
}

Deno.test('PhoneEnrollView (preact): renders the heading and a phone field', () => {
  const html = render(BASE_PROPS)
  assertStringIncludes(html, '<h1>Verify your phone number</h1>')
  assertStringIncludes(html, 'name="phone"')
})

Deno.test('PhoneEnrollView (preact): carries the CSRF token via the shared authHiddenFields', () => {
  const html = render({ ...BASE_PROPS, csrfToken: 'the-token' })
  assertStringIncludes(html, 'value="the-token"')
})
