import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'

import TotpEnrollPage from 'space/routes/[lang]/totp/enroll/page.tsx'
import { renderQrCodeSvg } from 'utils/qr-code.ts'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { renderComponentWithIntl } from '../../helpers/space-context.ts'

/** Mirrors `en/index.json`'s own real keys `TotpEnrollView` formats. */
const TEST_MESSAGES = {
  'totp/enroll/heading': 'Set up an authenticator app',
  'totp/enroll/invalid-code': 'Invalid authenticator code — scan the new code below.',
  'totp/enroll/scan-aria-label': 'Scan this QR code with your authenticator app',
  'totp/enroll/scan-instructions':
    'Scan this in your authenticator app, or enter the key manually:',
  'totp/enroll/code-label': 'Authenticator code',
  'totp/enroll/submit': 'Confirm',
}

function renderEnrollView(props: Parameters<InstanceType<typeof TotpEnrollPage>['component']>[0]) {
  const page = new TotpEnrollPage(mockHandlerContext())
  return renderComponentWithIntl(page.component, props, TEST_MESSAGES)
}

type EnrollParams = { lang: string }

Deno.test(
  'TotpEnrollPage.loader: surfaces the freshly generated secret/uri and error flag',
  async () => {
    const page = new TotpEnrollPage(mockHandlerContext())
    mockAccessor(page, 'interactor', {
      // `AuthService.totpEnroll` is real async work (it looks up the account's email) — a plain
      // returned object still works fine through the loader's own `await`, but `fn()` wrapping a
      // `Promise.resolve(...)` here matches the real interactor's shape more closely than a bare
      // sync return would.
      totpEnroll: fn(() =>
        Promise.resolve({ secret: 'SECRET123', uri: 'otpauth://totp/zanix-iam:jane' })
      ),
    })
    const ctx = mockPageContext<EnrollParams>({
      params: { lang: 'en' },
      request: new Request('http://localhost/en/totp/enroll?error=invalid_code'),
    })
    const data = await page.loader?.(ctx) as {
      secret: string
      uri: string
      qrCodeSvg: string
      invalidCode: boolean
    }
    assertEquals(data.secret, 'SECRET123')
    assertEquals(data.uri, 'otpauth://totp/zanix-iam:jane')
    assertEquals(data.invalidCode, true)
  },
)

Deno.test(
  'TotpEnrollPage.loader: renders a QR code encoding the SAME uri, not a second copy',
  async () => {
    const page = new TotpEnrollPage(mockHandlerContext())
    const uri = 'otpauth://totp/zanix-iam:jane?secret=SECRET123&issuer=zanix-iam'
    mockAccessor(page, 'interactor', {
      totpEnroll: fn(() => Promise.resolve({ secret: 'SECRET123', uri })),
    })
    const ctx = mockPageContext<EnrollParams>({
      params: { lang: 'en' },
      request: new Request('http://localhost/en/totp/enroll'),
    })
    const data = await page.loader?.(ctx) as { qrCodeSvg: string }
    assertEquals(data.qrCodeSvg, renderQrCodeSvg(uri))
  },
)

Deno.test('TotpEnrollPage.component: renders the secret and QR markup passed in from the loader', () => {
  const html = renderEnrollView({
    lang: 'en',
    secret: 'SECRET123',
    uri: 'otpauth://totp/zanix-iam:jane',
    qrCodeSvg: '<svg>qr</svg>',
    invalidCode: true,
  })
  assertStringIncludes(html, 'Invalid authenticator code — scan the new code below.')
  // `dangerouslySetInnerHTML` renders its raw markup directly into the output — the SVG string
  // shows up verbatim, not re-escaped.
  assertStringIncludes(html, '<svg>qr</svg>')
  assertStringIncludes(html, 'SECRET123')
})

Deno.test('TotpEnrollPage.component: renders no invalid-code alert when the code was accepted', () => {
  const html = renderEnrollView({
    lang: 'en',
    secret: 'SECRET123',
    uri: 'otpauth://totp/zanix-iam:jane',
    qrCodeSvg: '<svg>qr</svg>',
    invalidCode: false,
  })
  assertEquals(html.includes('role="alert"'), false)
})
