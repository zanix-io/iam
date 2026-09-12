import { assertEquals, assertExists } from 'jsr:@std/assert@0.224'
import { mockPageContext } from '@zanix/space/testing'

import LangLayout, { loader } from 'space/routes/[lang]/layout.tsx'
import { COOKIE_CONSENT_ENABLED_ENV, MESSAGES_ENV } from 'utils/constants.ts'

type LangParams = { lang: string }

Deno.test("LangLayout's own loader: forwards ctx.params.lang", async () => {
  const ctx = mockPageContext<LangParams>({ params: { lang: 'en' } })
  const data = await loader(ctx)
  assertEquals(data.lang, 'en')
})

Deno.test(
  "LangLayout's own loader: cookiesDecided is false with no consent cookie recorded",
  async () => {
    const ctx = mockPageContext<LangParams>({
      params: { lang: 'en' },
      request: new Request('http://localhost/en/'),
    })
    assertEquals((await loader(ctx)).cookiesDecided, false)
  },
)

Deno.test(
  "LangLayout's own loader: cookiesDecided is true once a decision (accepted OR declined) is " +
    'recorded',
  async () => {
    const acceptedCtx = mockPageContext<LangParams>({
      params: { lang: 'en' },
      request: new Request('http://localhost/en/', {
        headers: { cookie: 'X-Znx-Cookies-Accepted=true' },
      }),
    })
    const declinedCtx = mockPageContext<LangParams>({
      params: { lang: 'en' },
      request: new Request('http://localhost/en/', {
        headers: { cookie: 'X-Znx-Cookies-Accepted=false' },
      }),
    })
    assertEquals((await loader(acceptedCtx)).cookiesDecided, true)
    assertEquals((await loader(declinedCtx)).cookiesDecided, true)
  },
)

Deno.test("LangLayout's own loader: forwards ctx.cspNonce", async () => {
  // `mockPageContext` doesn't forward `cspNonce` from its own overrides (a real, confirmed gap in
  // `@zanix/space/testing` — filed via `zanix report-issue`) — built here directly instead of
  // through that helper for this one field.
  const ctx = { ...mockPageContext<LangParams>({ params: { lang: 'en' } }), cspNonce: 'abc123' }
  assertEquals((await loader(ctx)).cspNonce, 'abc123')
})

/**
 * `loadMessages()` itself — resolving `en/index.json` for real — is `@zanix/space`'s own already-
 * tested behavior, not re-verified here. It ALSO can't resolve a real file in a plain `deno test`
 * run for this project specifically: `space.app.ts` declares `clientBuildDir`, so `resolve()`
 * (outside `zanix space dev`) looks for the COMPILED catalog under `.dist/client/messages/...`,
 * which only exists after a real `zanix space build` — see `loadMessages`'s own doc for that
 * dev/prod split. What IS this project's own responsibility, and what these two tests actually
 * cover: the catalog FILE'S real content (read directly, independent of the resolution pipeline),
 * and that `IAM_MESSAGES` overrides make it into `data.messages` regardless of what the base
 * catalog resolved to.
 */
Deno.test("en/index.json (the base catalog) contains the real login/* keys LoginView's own useIntl() calls reference", async () => {
  const raw = await Deno.readTextFile(
    new URL('../../../../space/messages/en/index.json', import.meta.url),
  )
  const catalog = JSON.parse(raw) as Record<string, string>
  assertEquals(catalog['login/invalid-credentials'], 'Invalid email or password.')
  assertEquals(catalog['login/email-label'], 'Email')
  assertEquals(catalog['login/password-label'], 'Password')
  assertEquals(catalog['login/submit'], 'Sign in')
  assertEquals(catalog['login/terms-link'], 'Terms and Conditions')
  assertEquals(catalog['login/oauth-continue'], 'Continue with {provider}')
})

Deno.test("LangLayout's own loader: an IAM_MESSAGES override reaches data.messages", async () => {
  const original = Deno.env.get(MESSAGES_ENV)
  Deno.env.set(MESSAGES_ENV, '{"login/submit":"Iniciar sesión"}')
  try {
    const ctx = mockPageContext<LangParams>({ params: { lang: 'en' } })
    const data = await loader(ctx)
    assertEquals(data.messages['login/submit'], 'Iniciar sesión')
  } finally {
    if (original === undefined) Deno.env.delete(MESSAGES_ENV)
    else Deno.env.set(MESSAGES_ENV, original)
  }
})

/** `LangLayout` now delegates its actual rendering to `@zanix/iam/ui/pages/lang-layout`'s own
 * factory-built view (`createElement`-based, never JSX) — its returned `ReactElement`'s own `P`
 * generic is therefore genuinely `unknown` (no JSX literal for the type-checker to infer concrete
 * props from), unlike a plain JSX-authored component. This cast is this test's own accommodation
 * for that, not a real type-safety gap in `LangLayout` itself. */
type StructuralElement = { props: { lang?: string; children: unknown } }

Deno.test('LangLayout: renders <html lang> from its own loader data', () => {
  const element = LangLayout({
    children: 'content',
    data: { lang: 'fr', cookiesDecided: true, cspNonce: undefined, messages: {} },
    params: { lang: 'fr' },
  }) as unknown as StructuralElement
  assertEquals(element.props.lang, 'fr')
})

/** The `<body>` element's own `children` array — `[modalSlot, pageChildren]`, see `LangLayout`'s
 * own JSX. Restores whatever `COOKIE_CONSENT_ENABLED_ENV` was set to beforehand, same pattern
 * `login-page.test.ts` already uses for its own env-var-gated `loader` tests. Body's own single
 * child is now `<IntlProvider>` (wrapping `[modalSlot, pageChildren]`), not that array directly —
 * unwrapped one level further here than before `IntlProvider` existed. */
function bodyChildrenWithConsentEnv(value: string | undefined) {
  const original = Deno.env.get(COOKIE_CONSENT_ENABLED_ENV)
  if (value === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
  else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, value)
  try {
    const element = LangLayout({
      children: 'content',
      data: { lang: 'fr', cookiesDecided: true, cspNonce: undefined, messages: {} },
      params: { lang: 'fr' },
    }) as unknown as StructuralElement
    const [, body] = element.props.children as StructuralElement[]
    const intlProvider = body.props.children as StructuralElement
    return intlProvider.props.children as unknown[]
  } finally {
    if (original === undefined) Deno.env.delete(COOKIE_CONSENT_ENABLED_ENV)
    else Deno.env.set(COOKIE_CONSENT_ENABLED_ENV, original)
  }
}

Deno.test('LangLayout: mounts CookieConsentModal by default (COOKIE_CONSENT_ENABLED unset)', () => {
  const [modalSlot] = bodyChildrenWithConsentEnv(undefined)
  assertExists(modalSlot)
})

Deno.test("LangLayout: does not mount CookieConsentModal when it's explicitly disabled", () => {
  const [modalSlot] = bodyChildrenWithConsentEnv('false')
  // `null`, not `false` — `LangLayout` now builds this slot itself and hands it to
  // `@zanix/iam/ui/pages/lang-layout`'s own view as an explicit `cookieConsentSlot` prop, which
  // documents `null` (not a falsy JSX short-circuit) as its own "nothing to render" value.
  assertEquals(modalSlot, null)
})
