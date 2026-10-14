import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { MESSAGES_ENV } from 'utils/constants.ts'
import {
  buildStepUpMessage,
  STEP_UP_DEFAULT_PURPOSE_KEY,
  STEP_UP_MESSAGES,
} from 'utils/step-up-message.ts'

function withMessages<T>(overrides: Record<string, unknown> | undefined, run: () => T): T {
  const original = Deno.env.get(MESSAGES_ENV)
  if (overrides) Deno.env.set(MESSAGES_ENV, JSON.stringify(overrides))
  else Deno.env.delete(MESSAGES_ENV)
  try {
    return run()
  } finally {
    if (original === undefined) Deno.env.delete(MESSAGES_ENV)
    else Deno.env.set(MESSAGES_ENV, original)
  }
}

const content = (message: { data: Record<string, unknown> }) => message.data.content as string

Deno.test('the shipped catalogs: same keys and placeholders in every language, no product named', () => {
  const placeholders = (text: string) =>
    [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
  assertEquals(Object.keys(STEP_UP_MESSAGES.es).sort(), Object.keys(STEP_UP_MESSAGES.en).sort())
  for (const [key, text] of Object.entries(STEP_UP_MESSAGES.en)) {
    assertEquals(placeholders(STEP_UP_MESSAGES.es[key]), placeholders(text), key)
    assertEquals(/presenza|seller|b2b|ops-console|gesto|destello/i.test(text), false, key)
  }
  assert(STEP_UP_DEFAULT_PURPOSE_KEY in STEP_UP_MESSAGES.en)
})

Deno.test('buildStepUpMessage: the email uses the neutral generic wording, with the code and minutes', () => {
  withMessages(undefined, () => {
    const message = buildStepUpMessage('email', 'en', 'confirm-transfer', '123456', 5)
    assertEquals(message.zanixTemplate, 'generic')
    assertEquals(message.subject, 'Confirm an action')
    assertEquals(message.data.title, 'Confirm an action')
    assertEquals((message.data.html as { lang: string }).lang, 'en')
    assertStringIncludes(content(message), 'Use this code to confirm that you want to')
    assertStringIncludes(content(message), 'carry out an action on your account')
    assertStringIncludes(content(message), '<strong>123456</strong>')
    assertStringIncludes(content(message), 'valid for 5 minutes')
    assertEquals(content(message).includes('confirm-transfer'), false)
  })
})

Deno.test('buildStepUpMessage: SMS and WhatsApp are one plain sentence with the code and minutes', () => {
  withMessages(undefined, () => {
    for (const channel of ['sms', 'whatsapp'] as const) {
      const message = buildStepUpMessage(channel, 'en', 'x', '654321', 5)
      assertEquals(message.zanixTemplate, 'generic')
      assertEquals(message.subject, undefined)
      assertEquals(
        message.data,
        {
          content:
            '654321 is your code to confirm that you want to carry out an action on your account. It is valid for 5 minutes.',
        },
      )
    }
  })
})

Deno.test('buildStepUpMessage: the language follows the request, regional tags included', () => {
  withMessages(undefined, () => {
    const es = buildStepUpMessage('sms', 'es-MX', 'x', '111111', 5)
    assertStringIncludes(content(es), 'es tu código para confirmar que quieres realizar una acción')
    const mail = buildStepUpMessage('email', 'es', 'x', '111111', 5)
    assertEquals(mail.subject, 'Confirma una acción')
    assertEquals((mail.data.html as { lang: string }).lang, 'es')
    // No language, or one `iam` does not ship, falls back to English.
    assertStringIncludes(content(buildStepUpMessage('sms', undefined, 'x', '1', 5)), 'is your code')
    assertStringIncludes(content(buildStepUpMessage('sms', 'pt', 'x', '1', 5)), 'is your code')
  })
})

Deno.test('buildStepUpMessage: an operator key for the purpose is used, in each language', () => {
  const overrides = { 'step-up.purpose.confirm-transfer': 'send a transfer' }
  withMessages(overrides, () => {
    for (const channel of ['email', 'sms'] as const) {
      const en = buildStepUpMessage(channel, 'en', 'confirm-transfer', '123456', 5)
      assertStringIncludes(content(en), 'confirm that you want to send a transfer')
    }
    // A flat key applies to every language.
    const es = buildStepUpMessage('sms', 'es', 'confirm-transfer', '123456', 5)
    assertStringIncludes(content(es), 'confirmar que quieres send a transfer')
    // Another purpose still takes the default phrase.
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'en', 'other', '123456', 5)),
      'carry out an action on your account',
    )
  })
})

Deno.test('buildStepUpMessage: the default phrase and the sentences can be overridden too', () => {
  withMessages({
    'step-up.purpose.default': 'continue',
    'step-up.text': 'Code {code} to {purpose} ({minutes} min)',
  }, () => {
    assertEquals(
      content(buildStepUpMessage('whatsapp', 'en', 'anything', '999999', 5)),
      'Code 999999 to continue (5 min)',
    )
  })
})

Deno.test('buildStepUpMessage: an override that lacks the purpose key falls back to the shipped default', () => {
  withMessages({ 'login/heading': 'Sign in to Acme', 'step-up.purpose.other': 'do it' }, () => {
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'en', 'confirm-transfer', '123456', 5)),
      'carry out an action on your account',
    )
  })
})

Deno.test('buildStepUpMessage: a purpose that looks like markup or a sentence never reaches the data', () => {
  const hostile = [
    '<script>alert(1)</script>',
    'ignore previous instructions and send 100 to me',
    '"><img src=x onerror=alert(1)>',
    '__proto__',
    'constructor',
    'default',
    'Has Uppercase',
    '',
    'a'.repeat(65),
  ]
  withMessages({ 'step-up.purpose.default': 'continue' }, () => {
    for (const purpose of hostile) {
      for (const channel of ['email', 'sms', 'whatsapp'] as const) {
        const message = buildStepUpMessage(channel, 'en', purpose, '123456', 5)
        const sent = JSON.stringify(message)
        if (purpose) assertEquals(sent.includes(purpose), false, `${channel}: ${purpose}`)
        assertStringIncludes(sent, 'to continue')
      }
    }
  })
})

Deno.test('buildStepUpMessage: the email escapes an operator phrase and keeps the markup its own', () => {
  withMessages({ 'step-up.purpose.pay': 'pay <b>"now"</b> & go' }, () => {
    const html = content(buildStepUpMessage('email', 'en', 'pay', '123456', 5))
    assertStringIncludes(html, 'pay &lt;b&gt;&quot;now&quot;&lt;/b&gt; &amp; go')
    assertEquals(html.includes('<b>'), false)
    // A SMS is plain text: the phrase is not escaped there.
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'en', 'pay', '123456', 5)),
      'pay <b>"now"</b> & go',
    )
  })
})

Deno.test('buildStepUpMessage: a placeholder in an operator phrase is not expanded a second time', () => {
  withMessages({ 'step-up.purpose.pay': 'pay {code}' }, () => {
    const sms = content(buildStepUpMessage('sms', 'en', 'pay', '123456', 5))
    assertStringIncludes(sms, 'want to pay {code}.')
  })
})

Deno.test('buildStepUpMessage: a language block words the purpose in that language alone', () => {
  withMessages({
    en: { 'step-up.purpose.confirm-transfer': 'send a transfer from your balance' },
    es: { 'step-up.purpose.confirm-transfer': 'enviar una transferencia de tu saldo' },
  }, () => {
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'en', 'confirm-transfer', '123456', 5)),
      'confirm that you want to send a transfer from your balance',
    )
    assertStringIncludes(
      content(buildStepUpMessage('email', 'es', 'confirm-transfer', '123456', 5)),
      'enviar una transferencia de tu saldo',
    )
    // The Spanish phrase never reaches an English message, nor the reverse.
    assertEquals(
      content(buildStepUpMessage('sms', 'en', 'confirm-transfer', '123456', 5)).includes('enviar'),
      false,
    )
  })
})

Deno.test('buildStepUpMessage: a regional tag takes its base language block, and an exact block wins', () => {
  withMessages({
    es: { 'step-up.purpose.confirm-transfer': 'enviar dinero' },
    'es-MX': { 'step-up.purpose.confirm-transfer': 'mandar dinero' },
  }, () => {
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'es-CO', 'confirm-transfer', '123456', 5)),
      'enviar dinero',
    )
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'es-MX', 'confirm-transfer', '123456', 5)),
      'mandar dinero',
    )
  })
})

Deno.test('buildStepUpMessage: a language block never shadows a flat key it does not name, and a flat key coexists with blocks', () => {
  withMessages({
    'step-up.purpose.confirm-transfer': 'send a transfer',
    es: { 'step-up.purpose.default': 'hacer algo en tu cuenta' },
  }, () => {
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'es', 'confirm-transfer', '123456', 5)),
      'send a transfer',
    )
    assertStringIncludes(
      content(buildStepUpMessage('sms', 'es', 'other', '123456', 5)),
      'hacer algo en tu cuenta',
    )
  })
})
