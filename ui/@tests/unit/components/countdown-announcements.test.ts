import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createFormatter } from '@zanix/space-ui'
import { IAM_UI_LANGS, IAM_UI_MESSAGES_COMPILED } from '../../../sdk/messages.ts'
import { countdownAnnouncements } from '../../../sdk/countdown-announcements.ts'
import { RateLimitCountdown } from 'ui/components/rate-limit-countdown/index.ts'
import { OtpResend } from 'ui/components/otp-resend/index.ts'

/**
 * The screen-reader announcement of both countdown Comets, mounted with the real `Countdown`: the
 * text must come out in the requested language, resolved from `iam`'s own catalog, with the
 * `{minutes}` marker reaching the component literally.
 */

const ENGLISH = /remaining|Less than|Time's up/

function announcementsFor(lang: string) {
  const { formatMessage } = createFormatter(lang, { ...IAM_UI_MESSAGES_COMPILED[lang] })
  return countdownAnnouncements((id) => formatMessage(id))
}

function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function liveText(container: HTMLElement): string {
  return container.querySelector('[aria-live]')?.textContent ?? ''
}

const rateLimit = (lang: string, target: number) =>
  createElement(RateLimitCountdown, {
    target,
    size: 72,
    strokeWidth: 5,
    formId: 'announcement-form',
    cardDataSpace: 'announcement-card',
    ...announcementsFor(lang),
  })

const otpResend = (lang: string, cooldownEndsAt: number) =>
  createElement(OtpResend, {
    lang,
    email: 'jane@example.com',
    resendLabel: 'r',
    cooldownLabel: 'c',
    cooldownEndsAt,
    ...announcementsFor(lang),
  })

Deno.test('countdownAnnouncements: the {minutes} marker reaches the component literally, in every language', () => {
  for (const lang of IAM_UI_LANGS) {
    const texts = announcementsFor(lang)
    assert(texts.announcementMinutes.includes('{minutes}'), lang)
    assertEquals(Object.values(texts).every((text) => text.length > 0), true, lang)
  }
  assertEquals(announcementsFor('en').announcementDone, "Time's up")
  assertEquals(announcementsFor('es').announcementDone, 'Se acabó el tiempo')
  assertEquals(announcementsFor('es').announcementMinutes, '{minutes} minutos restantes')
})

for (
  const [name, build] of [['RateLimitCountdown', rateLimit], ['OtpResend', otpResend]] as const
) {
  Deno.test(`${name}: the last-minute announcement is in Spanish and has no English left`, () => {
    const { container, unmount } = mount(build('es', Date.now() + 30_000))
    const text = liveText(container)
    unmount()
    assertEquals(text, 'Queda menos de un minuto')
    assertFalse(ENGLISH.test(text))
  })

  Deno.test(`${name}: the last-minute announcement is in English`, () => {
    const { container, unmount } = mount(build('en', Date.now() + 30_000))
    const text = liveText(container)
    unmount()
    assertEquals(text, 'Less than a minute remaining')
  })

  Deno.test(`${name}: minutes remaining fill the marker, in the requested language`, () => {
    const es = mount(build('es', Date.now() + 5 * 60_000 - 500))
    const esText = liveText(es.container)
    es.unmount()
    assertEquals(esText, '5 minutos restantes')
    assertFalse(ENGLISH.test(esText))

    const en = mount(build('en', Date.now() + 5 * 60_000 - 500))
    const enText = liveText(en.container)
    en.unmount()
    assertEquals(enText, '5 minutes remaining')
  })
}
