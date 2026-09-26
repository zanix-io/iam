import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createAuthHiddenFields } from 'ui/components/auth-hidden-fields/render.ts'
import { createLoginPasswordStep } from 'ui/components/login-password-step/render.ts'
import type { LoginPasswordStepProps } from 'ui/components/login-password-step/types.ts'

const createElement = h as unknown as CreateElement<VNode>

/** Stubs for the space-ui bindings: the step's own markup is what is under test, not theirs. */
const LoginPasswordStep = createLoginPasswordStep<VNode>(createElement, {
  Button: (props) =>
    h(
      'button',
      { type: props.type, class: props.className, disabled: props.disabled },
      props.children as string,
    ) as VNode,
  Field: ({ id, label, children }) =>
    h('div', { 'data-field': id }, h('label', {}, label), children({ id })) as VNode,
  Link: (props) => h('a', { href: props.href }, props.children as string) as VNode,
  PasswordToggleField: (props) =>
    h('input', {
      name: props.name,
      'data-show': props.showLabel,
      'data-hide': props.hideLabel,
      disabled: props.disabled,
    }) as VNode,
  RateLimitCard: (props) =>
    h(
      'div',
      { 'data-stub': 'card', 'data-form': props.formId, 'data-space': props.cardDataSpace },
      [
        props.headingLabel,
        props.bodyLabel,
      ],
    ) as VNode,
  authHiddenFields: createAuthHiddenFields<VNode>(createElement),
})

const LABELS = {
  heading: 'Enter your password',
  signingInAs: 'Signing in as',
  invalidPassword: 'Wrong password.',
  rateLimited: 'Too many attempts.',
  rateLimitedHeading: 'Paused for a moment.',
  rateLimitedBody: 'Try again in:',
  unexpectedError: 'Something went wrong.',
  passwordLabel: 'Password',
  showPassword: 'Show',
  hidePassword: 'Hide',
  submit: 'Sign in',
  forgotPassword: 'Forgot it?',
  useAnotherEmail: 'Use another email',
}

const BASE: LoginPasswordStepProps = {
  lang: 'en',
  email: 'ana@example.com',
  passwordStep: true,
  csrfToken: 'tok',
  invalidPassword: false,
  rateLimited: false,
  unexpectedError: false,
  labels: LABELS,
}

const html = (props: Partial<LoginPasswordStepProps> = {}) =>
  renderToString(h(LoginPasswordStep, { ...BASE, ...props }) as VNode)

Deno.test('LoginPasswordStep: renders the DOM hooks a two-step comet toggles', () => {
  const out = html()
  assertStringIncludes(out, 'data-login-step="password"')
  assertStringIncludes(out, '<strong data-login-email-display="true">ana@example.com</strong>')
  assertStringIncludes(out, '<div data-login-step="password">')
})

Deno.test('LoginPasswordStep: is hidden unless it is the step to show', () => {
  assertStringIncludes(html({ passwordStep: false }), 'data-login-step="password" hidden')
})

Deno.test('LoginPasswordStep: both forms carry the csrf token and the email', () => {
  const out = html()
  assertEquals(out.match(/name="_csrf" value="tok"/g)?.length, 2)
  assertEquals(out.match(/name="email" value="ana@example.com"/g)?.length, 2)
})

Deno.test('LoginPasswordStep: defaults are overridable by the consumer', () => {
  const defaults = html()
  assertStringIncludes(defaults, 'action="/en/login/password/recovery"')
  assertStringIncludes(defaults, 'href="/en/login"')
  assertStringIncludes(defaults, 'id="login-password-form"')
  assertStringIncludes(defaults, 'class="btn btn-primary btn-block"')
  assertEquals(defaults.includes('<h1 class'), false)

  const custom = html({
    options: {
      headingClassName: 'brand-title',
      submitClassName: 'primary',
      linkButtonClassName: 'quiet',
      formId: 'pw',
      recoveryAction: '/recover',
      loginHref: '/start',
    },
  })
  assertStringIncludes(custom, '<h1 class="brand-title">')
  assertStringIncludes(custom, 'class="primary"')
  assertStringIncludes(custom, 'class="quiet"')
  assertStringIncludes(custom, 'id="pw"')
  assertStringIncludes(custom, 'action="/recover"')
  assertStringIncludes(custom, 'href="/start"')
})

Deno.test('LoginPasswordStep: messages come from labels only', () => {
  const out = html({
    labels: { ...LABELS, heading: 'Contraseña', submit: 'Entrar', useAnotherEmail: 'Otro' },
  })
  assertStringIncludes(out, 'Contraseña')
  assertStringIncludes(out, 'Entrar')
  assert(!out.includes('Enter your password'))
})

Deno.test('LoginPasswordStep: an invalid password shows its banner', () => {
  assertStringIncludes(html({ invalidPassword: true }), 'Wrong password.')
})

Deno.test('LoginPasswordStep: a live rate limit shows the card and disables the form', () => {
  const out = html({ rateLimited: true, retryUntil: Date.now() + 60_000 })
  assertStringIncludes(out, 'data-stub="card"')
  assertStringIncludes(out, 'data-form="login-password-form"')
  assertStringIncludes(out, 'data-space="login-password-rate-limit"')
  assertEquals(out.match(/disabled/g)?.length, 2)
  assert(!out.includes('Too many attempts.'))
})

Deno.test('LoginPasswordStep: a stale or missing retryUntil falls back to the plain banner', () => {
  for (const retryUntil of [undefined, Date.now() - 1000]) {
    const out = html({ rateLimited: true, retryUntil })
    assertStringIncludes(out, 'Too many attempts.')
    assert(!out.includes('data-stub="card"'))
    assert(!out.includes('disabled'))
  }
})

Deno.test('LoginPasswordStep: an unexpected error shows its banner', () => {
  assertStringIncludes(html({ unexpectedError: true }), 'Something went wrong.')
})

Deno.test('LoginPasswordStep: recoveryAction false omits the forgot-password form', () => {
  const out = html({ options: { recoveryAction: false } })
  assert(!out.includes('Forgot it?'))
  assert(!out.includes('/recovery'))
  assertEquals(out.match(/name="_csrf"/g)?.length, 1)
  assertStringIncludes(out, 'href="/en/login"')
})

Deno.test('LoginPasswordStep: without a forgotPassword label there is no recovery form', () => {
  const { forgotPassword: _omitted, ...labels } = LABELS
  const out = html({ labels })
  assert(!out.includes('/recovery'))
  assertEquals(out.match(/name="_csrf"/g)?.length, 1)
})
