/**
 * @module
 *
 * The message catalogs of `iam`'s screens — the `./ui/sdk/messages` subpath. Plain data, never a
 * component, and no `@zanix/space` import: a consumer on any framework, or none, can read them.
 *
 * Three ways to use them, one per way of consuming `iam`:
 *
 * - **Its views, inside a `@zanix/space` app.** Declare {@linkcode iamMessages} in
 *   `defineSpaceApp({ messageSources })`. The app's own `messagesDir` always wins a key, so an app
 *   rewords a message, or adds a whole language `iam` does not ship, by defining the keys in its own
 *   `messages/` folder — no change to `iam`.
 * - **Its own UI on the headless SDK.** Read {@linkcode IAM_UI_MESSAGES} (or a language's export) and
 *   format with the i18n layer the UI already has.
 * - **Backend only, or the hosted pages.** Nothing to do: the hosted pages use these same catalogs
 *   and a backend integration never imports this module.
 */
import { IAM_UI_MESSAGES_EN } from './messages/en.ts'
import { IAM_UI_MESSAGES_ES } from './messages/es.ts'
import { IAM_UI_MESSAGES_EN_COMPILED } from './messages/compiled/en.ts'
import { IAM_UI_MESSAGES_ES_COMPILED } from './messages/compiled/es.ts'

export { IAM_UI_MESSAGES_EN, IAM_UI_MESSAGES_ES }

/** A message catalog: flat, namespaced keys to plain strings with `{token}` placeholders. */
export type IamMessages = Readonly<Record<string, string>>

/** A message catalog compiled to ICU AST: each value is the parsed message, ready to format. */
export type IamCompiledMessages = Readonly<
  Record<string, { type: number; value?: string; [key: string]: unknown }[]>
>

/** The catalogs `iam` ships, by language code. */
export const IAM_UI_MESSAGES: Readonly<Record<string, IamMessages>> = {
  en: IAM_UI_MESSAGES_EN,
  es: IAM_UI_MESSAGES_ES,
}

/** The same catalogs compiled to ICU AST, by language code. Generated from
 * {@linkcode IAM_UI_MESSAGES} (`deno task gen:messages`); a test keeps the two in step. */
export const IAM_UI_MESSAGES_COMPILED: Readonly<Record<string, IamCompiledMessages>> = {
  en: IAM_UI_MESSAGES_EN_COMPILED,
  es: IAM_UI_MESSAGES_ES_COMPILED,
}

/** The language codes `iam` ships catalogs for. */
export const IAM_UI_LANGS: readonly string[] = Object.keys(IAM_UI_MESSAGES)

/** A regional code (`es-MX`, `pt_BR`) resolves to its exact entry when there is one, else to its
 * language; anything else is `undefined`, never another language. */
function byLanguage<T>(table: Readonly<Record<string, T>>, lang: string): T | undefined {
  const exact = table[lang]
  if (exact) return exact
  const language = lang.split(/[-_]/)[0]?.toLowerCase()
  return language ? table[language] : undefined
}

/**
 * The plain-string catalog of a language, or `undefined` when `iam` does not ship it — never a
 * fallback to another language, so an app that adds its own language sees exactly what it defines.
 * A regional code (`es-MX`, `pt_BR`) resolves to its exact catalog when one exists, else to its
 * language.
 */
export function getIamMessages(lang: string): IamMessages | undefined {
  return byLanguage(IAM_UI_MESSAGES, lang)
}

/** {@linkcode getIamMessages} for the catalog compiled to ICU AST. */
export function getIamCompiledMessages(lang: string): IamCompiledMessages | undefined {
  return byLanguage(IAM_UI_MESSAGES_COMPILED, lang)
}

/**
 * `iam`'s catalogs as a `@zanix/space` message source: pass it to `defineSpaceApp({ messageSources
 * })`. It answers the base catalog of a language `iam` ships and nothing for any other language or
 * for a population override, which leaves those entirely to the app's own `messagesDir`.
 *
 * It answers the catalog **compiled to ICU AST**, like the catalogs `zanix space build` compiles
 * from the app's own `messagesDir`, so nothing is parsed at run time. A consumer's own string for
 * the same key replaces it: the two forms mix freely, key by key.
 *
 * Structurally a `MessagesSource`; declared here without importing that type so this module keeps no
 * dependency on `@zanix/space`.
 */
export function iamMessages(lang: string, population?: string): IamCompiledMessages | undefined {
  return population === undefined ? getIamCompiledMessages(lang) : undefined
}
