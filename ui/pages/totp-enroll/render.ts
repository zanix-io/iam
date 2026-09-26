import type { Formatter } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { TotpEnrollViewProps } from './types.ts'

const CODE_FIELD_ID = 'totp-enroll-code'

/** This page's own `<form>` id — `SubmitGuard`'s own `formId` target. */
const FORM_ID = 'totp-enroll-form'

/** The `@zanix/space-ui` bindings, hook, and Comet this view needs, injected alongside `h` — see
 * `login/render.ts`'s own doc for why these are all passed through `h` as component REFERENCES,
 * never called directly. */
export type TotpEnrollViewDeps<E> = {
  useIntl: () => Formatter
  Button: (props: { type?: 'button' | 'submit' | 'reset' }) => E
  Field: (
    props: {
      id: string
      label: string
      error?: string | string[]
      children: (fieldProps: Record<string, unknown>) => E
    },
  ) => E
  Input: (props: Record<string, unknown>) => E
  SubmitGuard: (props: { formId: string }) => E | null
}

/**
 * The real implementation of `iam`'s TOTP enrollment view, shared identically between the React
 * and Preact bindings (`index.ts`/`index.preact.ts`) — both accept the identical
 * `dangerouslySetInnerHTML: {__html}` prop name on a host element, so the QR-code markup below
 * needs no renderer-specific handling. This file never imports React, Preact, or
 * `@zanix/space-ui` itself.
 *
 * No draft persistence (`SubmitGuard`, not `ManagedForm`): same single-use-code reasoning as
 * `login-otp/render.ts` — a stale, restored code tied to a since-regenerated `secret` would just
 * be actively wrong, never a convenience.
 */
export function createTotpEnrollView<E>(
  h: CreateElement<E>,
  deps: TotpEnrollViewDeps<E>,
): (props: TotpEnrollViewProps) => E {
  const { useIntl, Button, Field, Input, SubmitGuard } = deps

  return function TotpEnrollView(
    { lang, secret, uri, qrCodeSvg, csrfToken, invalidCode }: TotpEnrollViewProps,
  ): E {
    const { formatMessage } = useIntl()
    return h(
      'main',
      null,
      h('h1', null, formatMessage('totp/enroll/heading')),
      // The `data-space='banner'`/`data-variant` pair is the hook the default stylesheet
      // (`ui/styles.ts`) and an app's own CSS style; see `login/render.ts`.
      invalidCode
        ? h(
          'p',
          { role: 'alert', 'data-space': 'banner', 'data-variant': 'error' },
          formatMessage('totp/enroll/invalid-code'),
        )
        : null,
      // The QR code is the primary path — most authenticator apps scan it directly. The manual
      // secret/link right below it is a real fallback, never removed: some apps only support
      // typed-key entry, and it's what keeps enrollment possible if the QR image itself fails to
      // render (a broken `<img>`/inline-SVG scenario a scan-only flow would have no recovery
      // from).
      h('div', {
        role: 'img',
        'aria-label': formatMessage('totp/enroll/scan-aria-label'),
        dangerouslySetInnerHTML: { __html: qrCodeSvg },
      }),
      h(
        'p',
        null,
        `${formatMessage('totp/enroll/scan-instructions')} `,
        h('code', null, secret),
      ),
      // `data-space='otpauth-link'` — a bare `<a href>` with no hook would fall back to the
      // browser's default link styling, outside the design system every other control here
      // (`Field`/`Button`/`SubmitGuard`) follows. The default stylesheet (`ui/styles.ts`) styles
      // it, and an app's own CSS overrides that.
      h('p', null, h('a', { href: uri, 'data-space': 'otpauth-link' }, uri)),
      // Posts to the SIBLING `totp/confirm` page — both pages share the same `X-Znx-Csrf` cookie
      // (same origin, same cookie name), so the token this page's own `csrfGuard()` issues on
      // `GET` is exactly the one `../confirm/page.tsx`'s own `csrfGuard()` validates on `POST`.
      // `secret` round-trips through this hidden field because `AuthService.totpEnroll` never
      // persists it — see that method's own doc.
      h(SubmitGuard, { formId: FORM_ID }),
      h(
        'form',
        { method: 'post', id: FORM_ID, action: `/${lang}/totp/confirm` },
        h('input', { type: 'hidden', name: '_csrf', value: csrfToken ?? '' }),
        h('input', { type: 'hidden', name: 'secret', value: secret }),
        h(
          Field,
          {
            id: CODE_FIELD_ID,
            label: formatMessage('totp/enroll/code-label'),
            children: (fieldProps: Record<string, unknown>) =>
              h(Input, { ...fieldProps, name: 'code', type: 'text', required: true }),
          },
        ),
        h(Button, { type: 'submit' }, formatMessage('totp/enroll/submit')),
      ),
    )
  }
}
