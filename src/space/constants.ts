/**
 * This project's own `@zanix/space` frontend — supported languages for `langPreHandler`'s
 * `/{lang}/...` prefix routing (see `middleware.ts`). Every entry needs a catalog in
 * `IAM_UI_MESSAGES` (`ui/sdk/messages.ts`), which the hosted pages read through `iamMessages`.
 */
export const AVAILABLE_LANGS = ['en'] as const

/** The language `langPreHandler` resolves to when a request carries none of `AVAILABLE_LANGS`
 * (no cookie, no matching `Accept-Language`). */
export const DEFAULT_LANG: typeof AVAILABLE_LANGS[number] = 'en'
