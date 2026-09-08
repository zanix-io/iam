import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import { mockHandlerContext, mockPageContext } from '@zanix/space/testing'
import { HttpError } from '@zanix/errors'

import PasswordRecoveryCallbackPage from 'space/routes/[lang]/password/recovery/callback/page.tsx'
import { fn, mockAccessor } from '../../helpers/mock.ts'
import { mockActionContext } from '../../helpers/space-context.ts'

type CallbackParams = { lang: string }

function pageWithInteractor(recoveryCallback: (...args: unknown[]) => unknown) {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  mockAccessor(page, 'interactor', { recoveryCallback: fn(recoveryCallback) })
  return page
}

Deno.test('PasswordRecoveryCallbackPage.loader: pre-fills the email from the query string', () => {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  const request = new Request(
    'http://localhost/en/password/recovery/callback?email=jane%40example.com',
  )
  const ctx = mockPageContext<CallbackParams>({ params: { lang: 'en' }, request })
  const data = page.loader?.(ctx) as { email: string }
  assertEquals(data.email, 'jane@example.com')
})

// `<main>` children, in JSX order: h1, invalidCode slot, ManagedForm, form, — the `<form>` (index
// 3) itself carries [hidden csrf, email Field, code Field, password Field, Button].
function fieldsOf(element: { props: { children: unknown[] } }) {
  const form = (element.props.children as unknown[])[3] as { props: { children: unknown[] } }
  return {
    email: form.props.children[1] as { props: { error: string[] | undefined } },
    code: form.props.children[2] as { props: { error: string[] | undefined } },
    password: form.props.children[3] as { props: { error: string[] | undefined } },
  }
}

Deno.test('PasswordRecoveryCallbackPage.component: renders each field’s own flattened errors when present', () => {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  const element = page.component({
    email: 'jane@example.com',
    invalidCode: false,
    fieldErrors: {
      email: [{ constraints: ['Must be a valid email.'] }],
      code: [{ constraints: ['Code must be 6 digits.'] }],
    },
  })
  const fields = fieldsOf(element)
  assertEquals(fields.email.props.error, ['Must be a valid email.'])
  assertEquals(fields.code.props.error, ['Code must be 6 digits.'])
  // No `password` entry in `fieldErrors` — must stay `undefined`, not an empty array.
  assertEquals(fields.password.props.error, undefined)
})

Deno.test('PasswordRecoveryCallbackPage.component: renders no field errors when fieldErrors is unset', () => {
  const page = new PasswordRecoveryCallbackPage(mockHandlerContext())
  const element = page.component({ email: 'jane@example.com', invalidCode: false })
  const fields = fieldsOf(element)
  assertEquals(fields.email.props.error, undefined)
  assertEquals(fields.code.props.error, undefined)
  assertEquals(fields.password.props.error, undefined)
})

Deno.test('PasswordRecoveryCallbackPage.action: redirects home once the password resets', async () => {
  const page = pageWithInteractor(() => ({ accessToken: 'a', refreshToken: 'r' }))
  const ctx = mockActionContext<CallbackParams, { email: string; code: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', code: '123456', password: 'N3wPassw0rd' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(response?.headers.get('location'), '/')
})

Deno.test('PasswordRecoveryCallbackPage.action: PRGs back with an error flag on a rejected code', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('FORBIDDEN', { message: 'Invalid email or code.' })
  })
  const ctx = mockActionContext<CallbackParams, { email: string; code: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', code: 'bad', password: 'N3wPassw0rd' },
  })
  const response = await page.action?.(ctx as never)
  assertEquals(
    response?.headers.get('location'),
    '/en/password/recovery/callback?error=invalid_code',
  )
})

Deno.test('PasswordRecoveryCallbackPage.action: a real server-side fault propagates unchanged', async () => {
  const page = pageWithInteractor(() => {
    throw new HttpError('INTERNAL_SERVER_ERROR', { message: 'Notifier is unreachable.' })
  })
  const ctx = mockActionContext<CallbackParams, { email: string; code: string; password: string }>({
    params: { lang: 'en' },
    body: { email: 'jane@example.com', code: '123456', password: 'N3wPassw0rd' },
  })
  await assertRejects(() => page.action?.(ctx as never) as Promise<Response>)
})
