import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { smsTemplates, transactionalTemplates, whatsappTemplates } from '@zanix/notifications'

import { buildStepUpMessage } from 'utils/step-up-message.ts'

/** The messages of a step-up code are rendered by the built-in `generic` template of each channel,
 * which needs no stored template: the data built here must pass its schema and escape correctly. */

Deno.test('step-up message: the email data renders through the real generic email template', async () => {
  const message = buildStepUpMessage('email', 'es', 'confirm-transfer', '123456', 5)
  const html = await transactionalTemplates.generic(message.data as never)
  assertStringIncludes(html, '<html lang="es">')
  assertStringIncludes(html, 'Confirma una acción')
  assertStringIncludes(html, '<strong>123456</strong>')
  assertStringIncludes(html, 'realizar una acción en tu cuenta')
  assertStringIncludes(html, 'durante 5 minutos')
  assertEquals(html.includes('confirm-transfer'), false)
})

Deno.test('step-up message: the SMS and WhatsApp data render through the real generic templates', async () => {
  const message = buildStepUpMessage('sms', 'en', 'confirm-transfer', '654321', 5)
  const expected =
    '654321 is your code to confirm that you want to carry out an action on your account. It is valid for 5 minutes.'
  assertEquals((await smsTemplates.generic(message.data as never)).trim(), expected)
  assertEquals((await whatsappTemplates.generic(message.data as never)).trim(), expected)
})
