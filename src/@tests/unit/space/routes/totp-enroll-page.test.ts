import { assertEquals } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'

import TotpEnrollPage from 'space/routes/[lang]/totp/enroll/page.tsx'
import { renderQrCodeSvg } from 'utils/qr-code.ts'
import { fn, mockAccessor } from '../../helpers/mock.ts'

type EnrollParams = { lang: string }

Deno.test('TotpEnrollPage.loader: surfaces the freshly generated secret/uri and error flag', () => {
  const page = new TotpEnrollPage(mockHandlerContext())
  mockAccessor(page, 'interactor', {
    totpEnroll: fn(() => ({ secret: 'SECRET123', uri: 'otpauth://totp/zanix-iam:jane' })),
  })
  const ctx = mockPageContext<EnrollParams>({
    params: { lang: 'en' },
    request: new Request('http://localhost/en/totp/enroll?error=invalid_code'),
  })
  const data = page.loader?.(ctx) as {
    secret: string
    uri: string
    qrCodeSvg: string
    invalidCode: boolean
  }
  assertEquals(data.secret, 'SECRET123')
  assertEquals(data.uri, 'otpauth://totp/zanix-iam:jane')
  assertEquals(data.invalidCode, true)
})

Deno.test('TotpEnrollPage.loader: renders a QR code encoding the SAME uri, not a second copy', () => {
  const page = new TotpEnrollPage(mockHandlerContext())
  const uri = 'otpauth://totp/zanix-iam:jane?secret=SECRET123&issuer=zanix-iam'
  mockAccessor(page, 'interactor', {
    totpEnroll: fn(() => ({ secret: 'SECRET123', uri })),
  })
  const ctx = mockPageContext<EnrollParams>({
    params: { lang: 'en' },
    request: new Request('http://localhost/en/totp/enroll'),
  })
  const data = page.loader?.(ctx) as { qrCodeSvg: string }
  assertEquals(data.qrCodeSvg, renderQrCodeSvg(uri))
})

// deno-lint-ignore no-explicit-any
type Node = any

/** Depth-first search over a plain (unrendered) React element tree for the first node matching
 * `predicate` — resilient to JSX comment-only expression containers being omitted from
 * `props.children` by the compiler, unlike a fixed positional index. */
function findNode(node: Node, predicate: (node: Node) => boolean): Node | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return undefined
}

Deno.test('TotpEnrollPage.component: renders the secret and QR markup passed in from the loader', () => {
  const page = new TotpEnrollPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    secret: 'SECRET123',
    uri: 'otpauth://totp/zanix-iam:jane',
    qrCodeSvg: '<svg>qr</svg>',
    invalidCode: true,
  })
  const alert = findNode(element, (node) => node.props?.role === 'alert')
  assertEquals(alert?.props.children, 'Invalid authenticator code — scan the new code below.')
  const qrDiv = findNode(element, (node) => node.props?.role === 'img')
  assertEquals(qrDiv?.props.dangerouslySetInnerHTML.__html, '<svg>qr</svg>')
})

Deno.test('TotpEnrollPage.component: renders no invalid-code alert when the code was accepted', () => {
  const page = new TotpEnrollPage(mockHandlerContext())
  const element = page.component({
    lang: 'en',
    secret: 'SECRET123',
    uri: 'otpauth://totp/zanix-iam:jane',
    qrCodeSvg: '<svg>qr</svg>',
    invalidCode: false,
  })
  assertEquals(findNode(element, (node) => node.props?.role === 'alert'), undefined)
})
