import type { GuardContext, GuardResponse } from '@zanix/server'
import { isLangTag, parseAcceptLanguage } from '@zanix/helpers'

/** The `ctx.locals` key {@linkcode messageLangGuard} writes and {@linkcode contextMessageLang} reads. */
export const MESSAGE_LANG_LOCALS_KEY = 'messageLang'

/** The `?lang=` query parameter a client may send to name the language of the messages it triggers. */
export const MESSAGE_LANG_PARAM = 'lang'

/**
 * The language to send the messages of a request in: `?lang=` when the client names one, else the
 * `Accept-Language` of the request, else `undefined` (the notifications default applies).
 */
export function resolveMessageLang(req: Request, url: URL): string | undefined {
  const asked = url.searchParams.get(MESSAGE_LANG_PARAM)?.trim()
  return (isLangTag(asked) ? asked : undefined) ??
    parseAcceptLanguage(req.headers.get('accept-language'))[0]
}

/**
 * Records the language of the request in `ctx.locals`, where the interactors read it
 * ({@linkcode contextMessageLang}) to send the mails, SMS and WhatsApp messages the request
 * triggers in that language. Place it on every route that can send one.
 */
export function messageLangGuard(): (ctx: GuardContext) => GuardResponse {
  return (ctx) => {
    const lang = resolveMessageLang(ctx.req, ctx.url)
    if (lang) ctx.locals[MESSAGE_LANG_LOCALS_KEY] = lang
    return {}
  }
}

/** The language {@linkcode messageLangGuard} recorded for the request, if any. */
export function contextMessageLang(
  context: { locals?: Record<string, unknown> },
): string | undefined {
  const lang = context.locals?.[MESSAGE_LANG_LOCALS_KEY]
  return typeof lang === 'string' ? lang : undefined
}
