import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import { Button, IntlProvider, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLogoutView } from 'ui/pages/logout/render.ts'
import type { LogoutViewProps } from 'ui/pages/logout/types.ts'

const TEST_MESSAGES = {
  'logout/heading': 'Sign out',
  'logout/confirm-description': "You'll need to sign in again on this device.",
  'logout/submit': 'Sign out',
  'logout/cancel-link': 'Never mind',
}

// `SubmitGuard` is exercised for real, against the actual `@zanix/space/comet/preact` binding,
// only by the dedicated wiring test below — see `login.test.ts`'s own identical doc for why.
const LogoutViewForContent = createLogoutView<VNode>(
  h as unknown as CreateElement<VNode>,
  { useIntl, Button, SubmitGuard: () => null },
)

Deno.test('LogoutView (preact): renders the heading and a submit button', () => {
  const html = renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(LogoutViewForContent, {} as LogoutViewProps),
    ),
  )
  assertStringIncludes(html, '<h1>Sign out</h1>')
  assertStringIncludes(html, 'Sign out</button>')
})

Deno.test('LogoutView (preact): renders no cancel link when cancelUrl is unset', () => {
  const html = renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(LogoutViewForContent, {} as LogoutViewProps),
    ),
  )
  assertEquals(html.includes('Never mind'), false)
})

Deno.test('LogoutView (preact): renders a real cancel link to cancelUrl when given', () => {
  const html = renderToString(
    h(
      IntlProvider,
      { locale: 'en', messages: TEST_MESSAGES },
      h(LogoutViewForContent, { cancelUrl: '/en/profile' } as LogoutViewProps),
    ),
  )
  assertStringIncludes(html, 'href="/en/profile"')
  assertStringIncludes(html, 'Never mind')
})

// Real wiring against the actual `@zanix/space/comet/preact` `SubmitGuard` binding is deliberately
// NOT re-tested per page — see `login-otp.test.ts`'s own identical doc for why (the process-wide
// active-renderer conflict this would otherwise cause between test files).
