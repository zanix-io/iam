import { assertEquals, assertRejects } from 'jsr:@std/assert@0.224'
import type { PageActionContext, PageContext } from '@zanix/space'
import {
  handleLoginEntryAction,
  handleOtpResendAction,
  handleOtpVerifyAction,
  handleReactivateAction,
} from '../../../space/login-pages.ts'

/**
 * `login-pages.ts` branches outside `login-pages.test.ts`: a session whose access token carries no
 * `sub` claim (the session still applies; only the optional token cache is skipped), and a
 * non-upstream failure from the password sign-in and the code resend (propagates, never turned
 * into a redirect).
 */

const ctx = <T extends Record<string, string>>(params: T, path = '/') =>
  ({
    params,
    url: new URL(`https://app.test${path}`),
    csrfToken: 'csrf',
    cspNonce: 'nonce',
    id: 'test-request',
    locals: {},
    cookies: {},
  }) as unknown as PageContext<T> & PageActionContext<T>

const location = (response: Response) => response.headers.get('location') ?? ''

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A structurally valid (decodable, unsigned) access token that carries no `sub` claim. */
const noSubjectSession = () =>
  Promise.resolve({
    accessToken: `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ type: 'user' })}.sig`,
    refreshToken: 'r',
    expiresAt: 3600,
  })

function recordingCache() {
  const subjects: string[] = []
  return { subjects, cacheTokens: (subject: string) => (subjects.push(subject), Promise.resolve()) }
}

Deno.test('handleLoginEntryAction: a password sign-in with no subject claim still signs in, skipping the token cache', async () => {
  const { subjects, cacheTokens } = recordingCache()
  const response = await handleLoginEntryAction(ctx({ lang: 'es' }), {
    loginClient: { login: noSubjectSession } as never,
    otpClient: { request: () => Promise.resolve() } as never,
    email: 'ana@x.test',
    password: 'secret',
    defaultPath: '/es/home',
    cacheTokens,
  })
  assertEquals(location(response), '/es/home')
  assertEquals(subjects, [])
})

Deno.test('handleLoginEntryAction: a non-upstream failure of the password sign-in propagates', async () => {
  await assertRejects(
    () =>
      handleLoginEntryAction(ctx({ lang: 'es' }), {
        loginClient: { login: () => Promise.reject(new TypeError('bug')) } as never,
        otpClient: { request: () => Promise.resolve() } as never,
        email: 'ana@x.test',
        password: 'secret',
        defaultPath: '/es/home',
      }),
    TypeError,
  )
})

Deno.test('handleOtpVerifyAction: a session with no subject claim still signs in, skipping the token cache', async () => {
  const { subjects, cacheTokens } = recordingCache()
  const response = await handleOtpVerifyAction(ctx({ lang: 'es', email: 'ana%40x.test' }), {
    otpClient: { verify: noSubjectSession } as never,
    code: '123456',
    defaultPath: '/es/home',
    cacheTokens,
  })
  assertEquals(location(response), '/es/home')
  assertEquals(subjects, [])
})

Deno.test('handleReactivateAction: a session with no subject claim still signs in, skipping the token cache', async () => {
  const { subjects, cacheTokens } = recordingCache()
  const response = await handleReactivateAction(ctx({ lang: 'es', token: 'tok' }), {
    loginClient: { confirmReactivation: noSubjectSession } as never,
    defaultPath: '/es/home',
    cacheTokens,
  })
  assertEquals(location(response), '/es/home')
  assertEquals(subjects, [])
})

Deno.test('handleOtpResendAction: a non-upstream dispatch failure propagates and stamps no cooldown', async () => {
  const stamped: string[] = []
  await assertRejects(
    () =>
      handleOtpResendAction(ctx({ lang: 'es', email: 'a%40x.test' }), {
        otpClient: { request: () => Promise.reject(new TypeError('bug')) } as never,
        notifier: undefined,
        cooldown: {
          endsAt: () => Promise.resolve(undefined),
          stamp: (email: string) => (stamped.push(email), Promise.resolve()),
        },
      }),
    TypeError,
  )
  assertEquals(stamped, [])
})

Deno.test('handleOtpVerifyAction: a second factor delivered as a code (not TOTP) goes back to the code page for it', async () => {
  const response = await handleOtpVerifyAction(
    ctx({ lang: 'es', email: 'ana%40x.test' }, '/?redirect_to=/es/orders'),
    {
      otpClient: {
        verify: () =>
          Promise.resolve({ message: 'second factor', email: 'ana@x.test', method: 'sms' }),
      } as never,
      code: '123456',
      defaultPath: '/es/home',
    },
  )
  assertEquals(location(response), '/es/login/otp/ana%40x.test?redirect_to=%2Fes%2Forders')
})

Deno.test('handleOtpVerifyAction: a code-delivered second factor uses the app-supplied code page when given', async () => {
  const response = await handleOtpVerifyAction(ctx({ lang: 'es', email: 'ana%40x.test' }), {
    otpClient: {
      verify: () =>
        Promise.resolve({ message: 'second factor', email: 'ana@x.test', method: 'sms' }),
    } as never,
    code: '123456',
    defaultPath: '/es/home',
    paths: { otp: (lang: string, email: string) => `/${lang}/verify-code/${email}` },
  } as never)
  assertEquals(location(response), '/es/verify-code/ana@x.test')
})
