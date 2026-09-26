import type { CreateElement } from 'ui/typings/renderer.ts'

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  google: 'Google',
  github: 'GitHub',
}

/** How an identity provider's code is shown to a person: its brand spelling when known, else the
 * code with a capital. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

const GOOGLE_MARK = [
  [
    '#EA4335',
    'M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13 17.7 9.5 24 9.5z',
  ],
  [
    '#4285F4',
    'M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.4-4.6 7.1l7.2 5.6c4.2-3.9 6.6-9.6 6.6-17.2z',
  ],
  [
    '#FBBC05',
    'M10.5 19.3c-.5 1.5-.8 3.1-.8 4.7s.3 3.2.8 4.7l-7.9 6.1C1 31.5 0 27.9 0 24s1-7.5 2.6-10.8z',
  ],
  [
    '#34A853',
    'M24 48c6.3 0 11.6-2.1 15.4-5.6l-7.2-5.6c-2 1.4-4.7 2.2-8.2 2.2-6.3 0-11.6-3.5-13.5-8.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z',
  ],
] as const

/**
 * The mark of a provider inside its button, or `null` for a provider without one. Inline markup
 * with no stylesheet, so it renders the same under a strict CSP and without any CSS loaded; an app
 * that wants a different mark styles the button by its `data-provider`.
 */
export function providerIcon<E>(h: CreateElement<E>, provider: string): E | null {
  if (provider !== 'google') return null
  return h(
    'svg',
    {
      'data-space': 'auth-provider-icon',
      viewBox: '0 0 48 48',
      width: 18,
      height: 18,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...GOOGLE_MARK.map(([fill, d]) => h('path', { key: fill, fill, d })),
  )
}
