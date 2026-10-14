import type { MessageCatalog } from '@zanix/notifications'
import type { NOTIFIERS } from './shared-enums.ts'

import { findText, langChain } from '@zanix/notifications'
import { resolveMessageOverrides } from './constants.ts'
import { STEP_UP_PURPOSE_REGEX } from './shared-enums.ts'

/** The key prefix of the wording of a step-up purpose: `step-up.purpose.<purpose>`. */
export const STEP_UP_PURPOSE_KEY_PREFIX = 'step-up.purpose.'

/** The key of the phrase used for a purpose that has no key of its own. */
export const STEP_UP_DEFAULT_PURPOSE_KEY = `${STEP_UP_PURPOSE_KEY_PREFIX}default`

/**
 * The wording of the step-up one-time code message, in the languages `iam` ships. It names no
 * product. Each message is a whole sentence with `{placeholder}`s, so a language orders its words
 * as it needs to:
 *
 * - `step-up.subject`, `step-up.title`: the subject and heading of the email.
 * - `step-up.intro`: the email sentence that says what the code confirms (the email `content`);
 *   `{purpose}` is the phrase of the purpose (`step-up.purpose.<purpose>`, else
 *   `step-up.purpose.default`), written to complete "confirm that you want to ...".
 * - `step-up.validity`: how long the code lasts, as plain text (the email `message`); `{minutes}`.
 * - `step-up.footer`: the email closing line.
 * - `step-up.text`: the whole SMS or WhatsApp message; `{code}`, `{purpose}`, `{minutes}`.
 *
 * The operator's `IAM_MESSAGES` is merged over it, key by key: a flat key for every language, a
 * language block (`{"es": {...}}`) for that language alone.
 */
export const STEP_UP_MESSAGES: Readonly<MessageCatalog> = {
  en: {
    'step-up.subject': 'Confirm an action',
    'step-up.title': 'Confirm an action',
    'step-up.intro': 'Use this code to confirm that you want to {purpose}.',
    'step-up.validity': 'The code is valid for {minutes} minutes.',
    'step-up.footer': 'If you did not request this code, you can ignore this message.',
    'step-up.text':
      '{code} is your code to confirm that you want to {purpose}. It is valid for {minutes} minutes.',
    'step-up.purpose.default': 'carry out an action on your account',
    'step-up.purpose.factor-change': 'change your verification method',
  },
  es: {
    'step-up.subject': 'Confirma una acción',
    'step-up.title': 'Confirma una acción',
    'step-up.intro': 'Usa este código para confirmar que quieres {purpose}.',
    'step-up.validity': 'El código es válido durante {minutes} minutos.',
    'step-up.footer': 'Si no solicitaste este código, puedes ignorar este mensaje.',
    'step-up.text':
      '{code} es tu código para confirmar que quieres {purpose}. Es válido durante {minutes} minutos.',
    'step-up.purpose.default': 'realizar una acción en tu cuenta',
    'step-up.purpose.factor-change': 'cambiar tu método de verificación',
  },
}

/** What {@linkcode buildStepUpMessage} answers: the template and data of a `NotifierProvider`
 * message, to spread into it.
 *
 * For email, `data` carries the fields the `generic` template renders: `html`, `title`, `content`
 * (the intro sentence, as markup), `buttonText` (the one-time code, with no `buttonLink`, so the
 * template shows it as a code), `message` (the validity sentence, plain text) and `footer`. The
 * login and recovery code emails use the same fields. For SMS and WhatsApp, `data` is `content`
 * alone. */
export type StepUpMessage = {
  /** Always the built-in `generic` template of the channel. */
  zanixTemplate: 'generic'
  /** The `data` of that template. */
  data: Record<string, unknown>
  /** The email subject; absent for SMS and WhatsApp. */
  subject?: string
}

/**
 * The catalog of the languages `chain` names: the shipped texts of each, with the operator's
 * `IAM_MESSAGES` overrides merged over them. A language `iam` does not ship has the overrides
 * alone, so the lookup falls on to the next language of the chain for every other key.
 */
function catalogFor(chain: string[]): MessageCatalog {
  const catalog: MessageCatalog = {}
  for (const lang of chain) {
    const texts = { ...STEP_UP_MESSAGES[lang], ...resolveMessageOverrides(lang) }
    if (Object.keys(texts).length) catalog[lang] = texts
  }
  return catalog
}

/**
 * Builds the one-time code message of a step-up for `channel`, in `lang`, as a `generic` template
 * message: the wording comes from {@linkcode STEP_UP_MESSAGES} merged with `IAM_MESSAGES`, so it
 * needs no stored template.
 *
 * `purpose` only selects the key `step-up.purpose.<purpose>`; its text never reaches the message.
 * A purpose that is malformed, or has no such key in any language of the chain, takes
 * `step-up.purpose.default`. The only values placed in a message are the code, the minutes and the
 * resolved phrase.
 *
 * In the email, the code travels in `buttonText` (without a `buttonLink`) and the validity sentence
 * in `message`, the fields the login and recovery emails use, so a `generic` template that styles
 * the one-time code styles this one too. The template escapes both when it renders them, so they
 * are passed as raw text; `content` and `footer` are rendered as markup, so the intro sentence and
 * the footer are HTML-escaped here.
 *
 * @param lang The language of the request, as a BCP 47 tag; `undefined` uses the notifications
 *   default.
 * @param minutes How long the code is valid, in minutes.
 */
export function buildStepUpMessage(
  channel: typeof NOTIFIERS[number],
  lang: string | undefined,
  purpose: string,
  code: string,
  minutes: number,
): StepUpMessage {
  const chain = langChain(lang)
  const catalog = catalogFor(chain)
  const text = (key: string, values: Record<string, unknown> = {}, escape = false): string =>
    findText(catalog, chain, key, values, escape) ?? ''

  // The phrase is looked up as plain text and escaped once, as a value of the message that carries it.
  const phrase =
    (STEP_UP_PURPOSE_REGEX.test(purpose) ? text(`${STEP_UP_PURPOSE_KEY_PREFIX}${purpose}`) : '') ||
    text(STEP_UP_DEFAULT_PURPOSE_KEY)

  if (channel !== 'email') {
    return {
      zanixTemplate: 'generic',
      data: { content: text('step-up.text', { code, purpose: phrase, minutes }) },
    }
  }

  const values = { purpose: phrase, minutes }
  return {
    zanixTemplate: 'generic',
    subject: text('step-up.subject'),
    data: {
      html: { lang: chain[0], title: text('step-up.title') },
      // The template escapes the title, the button text and the message; the content and footer are
      // rendered as markup, so they are escaped here.
      title: text('step-up.title'),
      content: `<p>${text('step-up.intro', values, true)}</p>`,
      buttonText: code,
      message: text('step-up.validity', values),
      footer: text('step-up.footer', {}, true),
    },
  }
}
