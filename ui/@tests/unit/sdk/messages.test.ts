import { assertEquals } from 'jsr:@std/assert@0.224'
import { join } from 'jsr:@std/path@0.224'
import { defineSpaceApp, loadMessages } from '@zanix/space'
import { createFormatter } from '@zanix/space-ui/preact'
import { parse } from '@formatjs/icu-messageformat-parser'

import {
  getIamCompiledMessages,
  getIamMessages,
  IAM_UI_LANGS,
  IAM_UI_MESSAGES,
  IAM_UI_MESSAGES_COMPILED,
  IAM_UI_MESSAGES_EN,
  IAM_UI_MESSAGES_ES,
  iamMessages,
} from '../../../sdk/messages.ts'

/** Keys a view reads through a value that is not a `formatMessage('literal')` call. */
const INDIRECT_KEYS = [
  'login/subtext',
  'login/subtext-no-oauth',
  'login/otp/notifier-email',
  'login/otp/notifier-sms',
  'login/otp/notifier-whatsapp',
]

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name)
    if (entry.isDirectory) {
      if (entry.name !== '@tests') files.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

/** Every key the views and components read: the literal argument of each `formatMessage()` call. */
function keysReadByViews(): Set<string> {
  const keys = new Set<string>(INDIRECT_KEYS)
  for (const dir of ['ui/pages', 'ui/components']) {
    for (const file of sourceFiles(dir)) {
      for (
        const match of Deno.readTextFileSync(file).matchAll(
          /formatMessage\(\s*['"`]([^'"`$]+)['"`]/g,
        )
      ) {
        keys.add(match[1])
      }
    }
  }
  return keys
}

/** The names of the arguments a message interpolates: `{email}`, `{channel, select, ...}`. */
function argumentNames(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]))].sort()
}

Deno.test('the catalogs: every value is a non-empty string', () => {
  for (const [lang, catalog] of Object.entries(IAM_UI_MESSAGES)) {
    for (const [key, value] of Object.entries(catalog)) {
      assertEquals(typeof value, 'string', `${lang}: ${key}`)
      assertEquals(value.length > 0, true, `${lang}: ${key} is empty`)
    }
  }
})

Deno.test('the catalogs: every language carries the same keys, interpolating the same arguments', () => {
  assertEquals(Object.keys(IAM_UI_MESSAGES_ES).sort(), Object.keys(IAM_UI_MESSAGES_EN).sort())
  for (const key of Object.keys(IAM_UI_MESSAGES_EN)) {
    assertEquals(
      argumentNames(IAM_UI_MESSAGES_ES[key]),
      argumentNames(IAM_UI_MESSAGES_EN[key]),
      key,
    )
  }
})

Deno.test('the catalogs: every key the views read is defined, and no key is left unread', () => {
  const read = keysReadByViews()
  const defined = new Set(Object.keys(IAM_UI_MESSAGES_EN))
  assertEquals([...read].filter((key) => !defined.has(key)).sort(), [], 'read but not defined')
  assertEquals([...defined].filter((key) => !read.has(key)).sort(), [], 'defined but never read')
})

Deno.test('the catalogs: plain strings with {token} placeholders, no ICU select or plural', () => {
  for (const [lang, catalog] of Object.entries(IAM_UI_MESSAGES)) {
    for (const [key, value] of Object.entries(catalog)) {
      assertEquals(
        /\{\w+\s*,\s*(select|plural|selectordinal)\s*,/.test(value),
        false,
        `${lang}: ${key}`,
      )
    }
  }
})

Deno.test('the catalogs: name no product, consumer app or identity provider', () => {
  const branded = /presenza|seller|b2b|ops-console|gesto|google|github/i
  for (const [lang, catalog] of Object.entries(IAM_UI_MESSAGES)) {
    for (const [key, value] of Object.entries(catalog)) {
      assertEquals(branded.test(value), false, `${lang}: ${key}: ${value}`)
    }
  }
})

Deno.test('getIamMessages: an exact language, then its base language, and nothing else', () => {
  assertEquals(getIamMessages('en'), IAM_UI_MESSAGES_EN)
  assertEquals(getIamMessages('es'), IAM_UI_MESSAGES_ES)
  assertEquals(getIamMessages('es-MX'), IAM_UI_MESSAGES_ES)
  assertEquals(getIamMessages('ES_ar'), IAM_UI_MESSAGES_ES)
  assertEquals(getIamMessages('pt'), undefined)
  assertEquals(getIamMessages('pt-BR'), undefined)
  assertEquals(getIamMessages(''), undefined)
  assertEquals(IAM_UI_LANGS, ['en', 'es'])
})

Deno.test('iamMessages: answers the compiled catalog of a shipped language, nothing for a population', () => {
  assertEquals(iamMessages('en'), IAM_UI_MESSAGES_COMPILED.en)
  assertEquals(iamMessages('es-MX'), IAM_UI_MESSAGES_COMPILED.es)
  assertEquals(getIamCompiledMessages('pt'), undefined)
  assertEquals(iamMessages('en', 'tenant-a'), undefined)
  assertEquals(iamMessages('fr'), undefined)
})

Deno.test('the compiled catalogs are the plain ones compiled: same keys, same AST as a fresh parse', () => {
  for (const lang of IAM_UI_LANGS) {
    const plain = IAM_UI_MESSAGES[lang]
    const compiled = IAM_UI_MESSAGES_COMPILED[lang]
    assertEquals(Object.keys(compiled).sort(), Object.keys(plain).sort(), lang)
    for (const [key, value] of Object.entries(plain)) {
      assertEquals<unknown>(
        compiled[key],
        parse(value),
        `${lang}: ${key} — run 'deno task gen:messages'`,
      )
    }
  }
})

Deno.test('the compiled catalogs format to exactly what the plain ones format to', () => {
  for (const lang of IAM_UI_LANGS) {
    const plain = createFormatter(lang, { ...IAM_UI_MESSAGES[lang] })
    const compiled = createFormatter(lang, { ...IAM_UI_MESSAGES_COMPILED[lang] })
    for (const [key, value] of Object.entries(IAM_UI_MESSAGES[lang])) {
      const args = Object.fromEntries(argumentNames(value).map((name) => [name, `<${name}>`]))
      assertEquals(
        compiled.formatMessage(key, args),
        plain.formatMessage(key, args),
        `${lang}: ${key}`,
      )
    }
  }
})

Deno.test('as a space message source, the app wins key by key and can add a language iam does not ship', async () => {
  const dir = await Deno.makeTempDir()
  try {
    await Deno.mkdir(join(dir, 'es'), { recursive: true })
    await Deno.mkdir(join(dir, 'pt'), { recursive: true })
    // Spanish: the app rewords one message and leaves the rest to iam.
    await Deno.writeTextFile(
      join(dir, 'es', 'iam.json'),
      JSON.stringify({ 'login/heading': 'Bienvenido de vuelta' }),
    )
    // Portuguese: iam ships nothing for it, the app supplies its own keys.
    await Deno.writeTextFile(
      join(dir, 'pt', 'iam.json'),
      JSON.stringify({ 'login/heading': 'Entrar', 'login/submit': 'Continuar' }),
    )
    defineSpaceApp({ name: 'consumer', messagesDir: dir, messageSources: [iamMessages] })

    const es = await loadMessages({ lang: 'es' })
    // The app's own string replaces one key; every other key is iam's compiled AST.
    assertEquals(es['login/heading'], 'Bienvenido de vuelta')
    assertEquals(es['login/submit'], IAM_UI_MESSAGES_COMPILED.es['login/submit'])
    assertEquals(Object.keys(es).length, Object.keys(IAM_UI_MESSAGES_ES).length)

    const pt = await loadMessages({ lang: 'pt' })
    assertEquals(pt, { 'login/heading': 'Entrar', 'login/submit': 'Continuar' })

    // A shipped language the app defines nothing for still resolves entirely from iam.
    assertEquals(await loadMessages({ lang: 'en' }), { ...IAM_UI_MESSAGES_COMPILED.en })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
