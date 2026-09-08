/**
 * This project's own `@zanix/space` frontend — supported languages for `langPreHandler`'s
 * `/{lang}/...` prefix routing (see `middleware.ts`). `['en']` only for now — this task is about
 * wiring the mechanism itself, not authoring a full multi-language content catalog; add a real
 * `messages/<lang>/` catalog (see `space-i18n-and-population`) before adding a second entry here.
 */
export const AVAILABLE_LANGS = ['en'] as const

/** The language `langPreHandler` resolves to when a request carries none of `AVAILABLE_LANGS`
 * (no cookie, no matching `Accept-Language`). */
export const DEFAULT_LANG: typeof AVAILABLE_LANGS[number] = 'en'
