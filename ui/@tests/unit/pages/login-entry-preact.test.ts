import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import type { VNode } from 'preact'
import { render as renderToString } from 'preact-render-to-string'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createLoginEntryView } from 'ui/pages/login-entry/render.ts'
import type { LoginEntryViewProps } from 'ui/pages/login-entry/types.ts'

const createElement = h as unknown as CreateElement<VNode>

/** Stubs for the three composed pieces: what is under test is how the view arranges and feeds them. */
const LoginEntryView = createLoginEntryView<VNode>(createElement, {
  useIntl: () => ({ formatMessage: (key: string) => `[${key}]` }) as never,
  LoginView: (props) => h('form', { 'data-stub': 'login-view', 'data-lang': props.lang }) as VNode,
  LoginPasswordStep: (props) =>
    h('section', {
      'data-stub': 'password-step',
      'data-shown': String(props.passwordStep),
      'data-email': props.email,
      'data-rate-limited': String(props.rateLimited),
      'data-unexpected': String(props.unexpectedError),
      'data-heading-class': props.options?.headingClassName ?? '',
      'data-recovery': String(props.options?.recoveryAction),
      'data-forgot': props.labels.forgotPassword ?? '',
      'data-heading': props.labels.heading,
      'data-unexpected-label': props.labels.unexpectedError,
    }) as VNode,
  LoginTwoStep: (props) =>
    h('i', {
      'data-stub': 'two-step',
      'data-comet': props.comet,
      'data-csrf': props.csrfToken,
    }) as VNode,
})

const BASE: LoginEntryViewProps<VNode> = {
  lang: 'es',
  csrfToken: 'tok',
  oauthProviders: [],
  invalidCredentials: false,
  rateLimited: false,
  unexpectedError: false,
  passwordStep: false,
  stepEmail: '',
  invalidPassword: false,
}

const html = (props: Partial<LoginEntryViewProps<VNode>> = {}) =>
  renderToString(h(LoginEntryView, { ...BASE, ...props }) as VNode)

Deno.test('LoginEntryView: the email step wraps LoginView, the password step and the comet follow', () => {
  const out = html()
  assertStringIncludes(
    out,
    '<div data-login-step="email"><form data-stub="login-view" data-lang="es">',
  )
  assert(out.indexOf('login-view') < out.indexOf('password-step'))
  assert(out.indexOf('password-step') < out.indexOf('two-step'))
  assertStringIncludes(out, 'data-comet="load"')
  assertStringIncludes(out, 'data-csrf="tok"')
})

Deno.test('LoginEntryView: the password step swaps places with the email step', () => {
  assertStringIncludes(html({ passwordStep: true }), '<div data-login-step="email" hidden>')
  assertStringIncludes(html({ passwordStep: true, stepEmail: 'a@b.co' }), 'data-email="a@b.co"')
  assertStringIncludes(html(), 'data-shown="false"')
})

Deno.test('LoginEntryView: rate-limit and failure states reach the password step only while it is shown', () => {
  const hidden = html({ rateLimited: true, unexpectedError: true })
  assertStringIncludes(hidden, 'data-rate-limited="false"')
  assertStringIncludes(hidden, 'data-unexpected="false"')
  const shown = html({ passwordStep: true, rateLimited: true, unexpectedError: true })
  assertStringIncludes(shown, 'data-rate-limited="true"')
  assertStringIncludes(shown, 'data-unexpected="true"')
})

Deno.test('LoginEntryView: copy comes from the host catalog under the documented keys', () => {
  const out = html()
  assertStringIncludes(out, 'data-heading="[login/password-step/heading]"')
  assertStringIncludes(out, 'data-forgot="[login/password-step/forgot-password]"')
  assertStringIncludes(out, 'data-unexpected-label="[login/unexpected-error]"')
})

Deno.test('LoginEntryView: presentation options pass through, and recoveryAction false drops the label', () => {
  const out = html({ headingClassName: 'brand', recoveryAction: false })
  assertStringIncludes(out, 'data-heading-class="brand"')
  assertStringIncludes(out, 'data-recovery="false"')
  assertEquals(out.includes('forgot-password'), false)
  assertStringIncludes(html(), 'data-recovery="undefined"')
})

Deno.test('LoginEntryView: the host frame wraps everything, a plain div otherwise', () => {
  const Card = (props: { children: VNode | VNode[] }) =>
    h('main', { 'data-frame': 'host' }, props.children) as VNode
  const framed = html({ Card })
  assertStringIncludes(framed, '<main data-frame="host"><div data-login-step="email"')
  assertStringIncludes(html(), '<div><div data-login-step="email"')
})
