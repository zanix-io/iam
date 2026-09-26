import { assertEquals } from 'jsr:@std/assert@0.224'
import { must } from '../dom-test-setup.ts'
import { createLoginTwoStep } from 'ui/components/login-two-step/render.ts'
import type { LoginTwoStepProps } from 'ui/components/login-two-step/types.ts'

type Intercept = (form: HTMLFormElement) => Promise<'handled' | 'proceed'>

/** Mounts the Comet against a stub hook that captures the intercept it registers. */
function mount(props: Partial<LoginTwoStepProps> = {}) {
  let captured: { formId: string; intercept: Intercept } | undefined
  const LoginTwoStep = createLoginTwoStep({
    useSubmitIntercept: (options) => {
      captured = options
    },
  })
  const rendered = LoginTwoStep({ lang: 'en', csrfToken: 'tok', ...props })
  return { rendered, options: must(captured) }
}

function page() {
  document.body.innerHTML = `
    <div data-login-step="email"><form id="login-form"><input name="email" value=" ana@example.com "></form></div>
    <div data-login-step="password" hidden>
      <strong data-login-email-display></strong>
      <form><input name="email"><input name="password"></form>
      <form><input name="email"></form>
    </div>`
  return must(document.getElementById('login-form') as HTMLFormElement | null)
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(handler(url, init))
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

Deno.test('LoginTwoStep: renders nothing and intercepts the email form by id', () => {
  const { rendered, options } = mount()
  assertEquals(rendered, null)
  assertEquals(options.formId, 'login-form')
  assertEquals(mount({ formId: 'other' }).options.formId, 'other')
})

Deno.test('LoginTwoStep: an email with a password reveals the password step in place', async () => {
  const form = page()
  const stub = stubFetch(() => Response.json({ hasPassword: true }))
  try {
    const result = await mount().options.intercept(form)
    assertEquals(result, 'handled')
    assertEquals(stub.calls[0].url, '/en/login/methods')
    assertEquals(
      (stub.calls[0].init.headers as Record<string, string>)['X-Znx-Csrf-Token'],
      'tok',
    )
    assertEquals(stub.calls[0].init.body, JSON.stringify({ email: 'ana@example.com' }))
    assertEquals(document.querySelector('[data-login-step="email"]')?.hasAttribute('hidden'), true)
    assertEquals(
      document.querySelector('[data-login-step="password"]')?.hasAttribute('hidden'),
      false,
    )
    assertEquals(
      document.querySelector('[data-login-email-display]')?.textContent,
      'ana@example.com',
    )
    const emailFields = document.querySelectorAll<HTMLInputElement>(
      '[data-login-step="password"] input[name="email"]',
    )
    assertEquals([...emailFields].map((field) => field.value), [
      'ana@example.com',
      'ana@example.com',
    ])
  } finally {
    stub.restore()
  }
})

Deno.test('LoginTwoStep: an email without a password proceeds with a real submit', async () => {
  const form = page()
  const stub = stubFetch(() => Response.json({ hasPassword: false }))
  try {
    assertEquals(await mount().options.intercept(form), 'proceed')
    assertEquals(document.querySelector('[data-login-step="email"]')?.hasAttribute('hidden'), false)
  } finally {
    stub.restore()
  }
})

Deno.test('LoginTwoStep: a failed lookup proceeds, leaving the decision to the server', async () => {
  const form = page()
  const failing = stubFetch(() => new Response('nope', { status: 500 }))
  try {
    assertEquals(await mount().options.intercept(form), 'proceed')
  } finally {
    failing.restore()
  }
  const throwing = stubFetch(() => {
    throw new Error('offline')
  })
  try {
    assertEquals(await mount().options.intercept(form), 'proceed')
  } finally {
    throwing.restore()
  }
})

Deno.test('LoginTwoStep: an empty email proceeds without any lookup', async () => {
  const form = page()
  must(form.querySelector<HTMLInputElement>('input[name="email"]')).value = '  '
  const stub = stubFetch(() => Response.json({ hasPassword: true }))
  try {
    assertEquals(await mount().options.intercept(form), 'proceed')
    assertEquals(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})

Deno.test('LoginTwoStep: the methods endpoint is overridable', async () => {
  const form = page()
  const stub = stubFetch(() => Response.json({ hasPassword: false }))
  try {
    await mount({ methodsHref: '/api/methods' }).options.intercept(form)
    assertEquals(stub.calls[0].url, '/api/methods')
  } finally {
    stub.restore()
  }
})

Deno.test('LoginTwoStep: with no CSRF token the lookup sends an empty CSRF header, never "undefined"', async () => {
  const form = page()
  const stub = stubFetch(() => Response.json({ hasPassword: false }))
  try {
    await mount({ csrfToken: undefined }).options.intercept(form)
    assertEquals((stub.calls[0].init.headers as Record<string, string>)['X-Znx-Csrf-Token'], '')
  } finally {
    stub.restore()
  }
})
