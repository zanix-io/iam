import { assert, assertEquals } from 'jsr:@std/assert@0.224'
import '../dom-test-setup.ts'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createOtpResend } from 'ui/components/otp-resend/render.ts'

/**
 * `OtpResend`'s countdown completion: once the cooldown ends, the countdown hides itself and the
 * resend button reappears, in the already-rendered page. The `Countdown` stub captures the
 * `onComplete` it receives; the rendered markup is mounted into a happy-dom document so that
 * callback runs against the real element ids.
 */

let onComplete: (() => void) | undefined
const OtpResend = createOtpResend<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  {
    Button: (props: Record<string, unknown>) =>
      createElement('button', { type: props.type }, props.children as never),
    Countdown: (props: Record<string, unknown>) => {
      onComplete = props.onComplete as () => void
      return createElement('span', { 'data-testid': 'countdown' })
    },
  },
)

Deno.test('OtpResend: when the cooldown completes, the countdown hides and the resend button shows', () => {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(OtpResend, {
      lang: 'en',
      email: 'jane@example.com',
      resendLabel: 'Resend code',
      cooldownLabel: 'Code sent.',
      cooldownEndsAt: Date.now() + 60_000,
    }),
  )
  const cooldown = document.getElementById('otp-resend-cooldown')
  const submit = document.getElementById('otp-resend-submit')
  assert(cooldown && submit)
  assertEquals([cooldown.hasAttribute('hidden'), submit.hasAttribute('hidden')], [false, true])

  assert(onComplete, 'the countdown must receive an onComplete callback')
  onComplete()

  assertEquals([cooldown.hasAttribute('hidden'), submit.hasAttribute('hidden')], [true, false])
})

Deno.test('OtpResend: completion tolerates a page where the elements are gone', () => {
  document.body.innerHTML = ''
  assert(onComplete)
  onComplete()
})
