import { assertEquals } from 'jsr:@std/assert@0.224'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpResend } from 'ui/components/otp-resend/render.ts'

/**
 * `OtpResend`'s own factory, exercised directly against stub `Button`/`Countdown` (never the real
 * Comet-wrapped bindings) — the same "test the raw factory in isolation" convention
 * `rate-limit-card.test.ts` establishes elsewhere in this package. The real Comet-wrapped
 * integration lives in `login-otp.test.ts`'s own composition tests, one level up.
 */

function stubButton(props: Record<string, unknown>): ReactElement {
  return createElement(
    'button',
    { type: props.type, className: props.className },
    props.children as never,
  )
}

function stubCountdown(props: Record<string, unknown>): ReactElement {
  return createElement('div', {
    'data-testid': 'stub-countdown',
    'data-target': String(props.target),
  })
}

const OtpResend = createOtpResend<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { Button: stubButton, Countdown: stubCountdown },
)

const BASE_PROPS = {
  lang: 'es',
  email: 'jane@example.com',
  csrfToken: 'csrf-token',
  resendLabel: '¿No te llegó? Reenviar código',
  cooldownLabel: 'Ya te enviamos un código.',
}

/** Finds a real, own-tag `hidden` attribute on the element opening at `tagIndex` — never a
 * substring match anywhere in its children (the CSRF `<input type="hidden">` legitimately
 * contains the literal string "hidden" too). */
function tagHasHiddenAttr(html: string, tagIndex: number): boolean {
  const openTag = html.slice(tagIndex, html.indexOf('>', tagIndex))
  return /(^|\s)hidden(\s|=|\/|>|$)/.test(openTag)
}

Deno.test('OtpResend: renders exactly one <form>, always — never a Fragment/second root', () => {
  const noCooldown = renderToStaticMarkup(createElement(OtpResend, BASE_PROPS))
  assertEquals((noCooldown.match(/<form/g) ?? []).length, 1)
  assertEquals(noCooldown.startsWith('<form'), true)

  const withCooldown = renderToStaticMarkup(
    createElement(OtpResend, { ...BASE_PROPS, cooldownEndsAt: Date.now() + 60_000 }),
  )
  assertEquals((withCooldown.match(/<form/g) ?? []).length, 1)
  assertEquals(withCooldown.startsWith('<form'), true)
})

Deno.test('OtpResend: no cooldown at all shows the submit button, no countdown rendered', () => {
  const html = renderToStaticMarkup(createElement(OtpResend, BASE_PROPS))
  assertEquals(html.includes('¿No te llegó? Reenviar código'), true)
  assertEquals(html.includes('stub-countdown'), false)
  const buttonWrapperIndex = html.indexOf('id="otp-resend-submit"')
  assertEquals(tagHasHiddenAttr(html, html.lastIndexOf('<span', buttonWrapperIndex)), false)
})

Deno.test(
  'OtpResend: an active cooldown hides ONLY the submit button, shows the live countdown — the form itself stays visible',
  () => {
    const html = renderToStaticMarkup(
      createElement(OtpResend, { ...BASE_PROPS, cooldownEndsAt: Date.now() + 60_000 }),
    )
    assertEquals(html.includes('Ya te enviamos un código.'), true)
    assertEquals(html.includes('stub-countdown'), true)

    const formOpenIndex = html.indexOf('<form')
    assertEquals(tagHasHiddenAttr(html, formOpenIndex), false)

    const buttonWrapperIndex = html.lastIndexOf('<span', html.indexOf('id="otp-resend-submit"'))
    assertEquals(tagHasHiddenAttr(html, buttonWrapperIndex), true)

    const cooldownWrapperIndex = html.lastIndexOf('<span', html.indexOf('id="otp-resend-cooldown"'))
    assertEquals(tagHasHiddenAttr(html, cooldownWrapperIndex), false)
  },
)

Deno.test('OtpResend: an already-past cooldownEndsAt shows the button, hides the (still-rendered) countdown', () => {
  const html = renderToStaticMarkup(
    createElement(OtpResend, { ...BASE_PROPS, cooldownEndsAt: Date.now() - 1000 }),
  )
  const buttonWrapperIndex = html.lastIndexOf('<span', html.indexOf('id="otp-resend-submit"'))
  assertEquals(tagHasHiddenAttr(html, buttonWrapperIndex), false)

  const cooldownWrapperIndex = html.lastIndexOf('<span', html.indexOf('id="otp-resend-cooldown"'))
  assertEquals(tagHasHiddenAttr(html, cooldownWrapperIndex), true)
})

Deno.test(
  'OtpResend: no notifierOptions (or a single one) renders no picker at all — the common case, no verified phone',
  () => {
    const noneHtml = renderToStaticMarkup(createElement(OtpResend, BASE_PROPS))
    assertEquals(noneHtml.includes('<select'), false)

    const oneHtml = renderToStaticMarkup(
      createElement(OtpResend, {
        ...BASE_PROPS,
        notifierOptions: [{ value: 'email', label: 'Email' }],
        currentNotifier: 'email',
        notifierPickerLabel: 'Send by',
      }),
    )
    assertEquals(oneHtml.includes('<select'), false)
  },
)

Deno.test(
  'OtpResend: 2+ notifierOptions render ONE <select> INSIDE the SAME form as the resend button — no second form, no second button',
  () => {
    const html = renderToStaticMarkup(
      createElement(OtpResend, {
        ...BASE_PROPS,
        notifierOptions: [
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS' },
          { value: 'whatsapp', label: 'WhatsApp' },
        ],
        currentNotifier: 'email',
        notifierPickerLabel: 'Enviar por',
      }),
    )
    assertEquals((html.match(/<form/g) ?? []).length, 1)
    assertEquals((html.match(/<button/g) ?? []).length, 1)
    assertEquals((html.match(/<select/g) ?? []).length, 1)
    assertEquals((html.match(/<option/g) ?? []).length, 3)
    assertEquals(html.includes('Enviar por'), true)
    assertEquals(html.includes('¿No te llegó? Reenviar código'), true)

    // The select sits BEFORE the submit button, inside the one real form.
    const selectIndex = html.indexOf('<select')
    const buttonIndex = html.indexOf('<button')
    assertEquals(selectIndex > -1 && buttonIndex > selectIndex, true)
  },
)

Deno.test('OtpResend: currentNotifier is pre-selected in the picker', () => {
  const html = renderToStaticMarkup(
    createElement(OtpResend, {
      ...BASE_PROPS,
      notifierOptions: [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }],
      currentNotifier: 'sms',
      notifierPickerLabel: 'Send by',
    }),
  )
  assertEquals(html.includes('<option value="email">Email</option>'), true)
  assertEquals(html.includes('<option value="sms" selected'), true)
})

Deno.test(
  'OtpResend: during a cooldown the channel picker stays visible; only the resend button is hidden',
  () => {
    const html = renderToStaticMarkup(
      createElement(OtpResend, {
        ...BASE_PROPS,
        cooldownEndsAt: Date.now() + 60_000,
        notifierOptions: [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }],
        currentNotifier: 'email',
        notifierPickerLabel: 'Send by',
      }),
    )
    const pickerIndex = html.indexOf('data-space="otp-resend-notifier-picker"')
    assertEquals(pickerIndex > -1, true)
    const pickerOpenTag = html.slice(
      html.lastIndexOf('<span', pickerIndex),
      html.indexOf('>', pickerIndex) + 1,
    )
    assertEquals(pickerOpenTag.includes('hidden'), false)
    assertEquals(html.includes('<select'), true)

    // The submit button IS hidden — only the action itself pauses during the cooldown.
    const buttonWrapperIndex = html.lastIndexOf('<span', html.indexOf('id="otp-resend-submit"'))
    assertEquals(tagHasHiddenAttr(html, buttonWrapperIndex), true)
  },
)
