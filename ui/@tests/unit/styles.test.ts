import { assertEquals } from 'jsr:@std/assert@0.224'
import { join } from 'jsr:@std/path@0.224'
import { IAM_UI_CSS, iamCssSource } from '../../styles.ts'

/** The top-level rule selectors of the stylesheet, comments removed. */
function selectors(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) =>
    m[2].trim()
  )
}

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name)
    if (entry.isDirectory) {
      if (entry.name !== '@tests') files.push(...sourceFiles(path))
    } else if (entry.name === 'render.ts') files.push(path)
  }
  return files
}

/** Every `data-space` hook a view writes as a literal, except the dynamic and shared ones. */
function hooksEmittedByViews(): Set<string> {
  const hooks = new Set<string>()
  for (const file of [...sourceFiles('ui/pages'), ...sourceFiles('ui/components')]) {
    for (const m of Deno.readTextFileSync(file).matchAll(/'data-space':\s*'([a-z][a-z-]*)'/g)) {
      hooks.add(m[1])
    }
  }
  return hooks
}

/** Hooks a view emits that this stylesheet leaves to the app: its own wrapper for a failed page. */
const LEFT_TO_THE_APP = new Set(['error', 'status', 'auth-provider-icon'])

Deno.test('the stylesheet: every rule is scoped to an iam hook, never a bare element or class', () => {
  const list = selectors(IAM_UI_CSS).flatMap((selector) => selector.split(/,\s*/))
  assertEquals(list.length > 30, true)
  assertEquals(list.filter((selector) => !/^\[data-(space|login-step)/.test(selector)), [])
})

Deno.test('the stylesheet: no selector is heavier than a hook plus one class or one pseudo-class', () => {
  // An app overrides a rule by writing the same specificity after it, or more. Every selector here
  // stays within (0,2,1): a hook attribute, one descendant class or attribute, and one pseudo.
  const heavy = selectors(IAM_UI_CSS)
    .flatMap((selector) => selector.split(/,\s*/))
    .filter((selector) =>
      (selector.replace(/\[[^\]]*\]/g, '.a').match(/\.|:(?!:)/g) ?? []).length > 3
    )
  assertEquals(heavy, [])
})

Deno.test('the stylesheet: the controls inside a hook outrank the generic element and field rules an app has', () => {
  // The channel picker's select and the code field's real input must beat an app's own `select {}`
  // and `[data-space-ui='input'] {}`, so they are written as a hook plus the control.
  assertEquals(IAM_UI_CSS.includes("[data-space='otp-resend-notifier-picker'] select {"), true)
  assertEquals(
    IAM_UI_CSS.includes("[data-space='otp-code-field'] .otp-code-field-real-input {"),
    true,
  )
})

Deno.test('the stylesheet: every design token it reads has a fallback, and none is a hard-coded override', () => {
  const withoutFallback = [...IAM_UI_CSS.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1])
  assertEquals(withoutFallback, [])
  const foreign = [...IAM_UI_CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g)]
    .map((m) => m[1])
    .filter((token) => !token.startsWith('--space-'))
  assertEquals(foreign, [])
  assertEquals(/!important/.test(IAM_UI_CSS), false)
})

Deno.test('the stylesheet: names no product or consumer app, embeds no data URI or import', () => {
  assertEquals(/presenza|seller|b2b|ops-console|gesto/i.test(IAM_UI_CSS), false)
  assertEquals(/data:|@import|url\(/.test(IAM_UI_CSS), false)
})

Deno.test('the stylesheet: styles every data-space hook the views emit, apart from the ones left to the app', () => {
  const styled = IAM_UI_CSS
  const missing = [...hooksEmittedByViews()]
    .filter((hook) => !LEFT_TO_THE_APP.has(hook))
    // The rate-limit card's root hook is chosen by the page; the stylesheet matches its suffix.
    .filter((hook) => !hook.endsWith('rate-limit'))
    .filter((hook) => !styled.includes(`data-space='${hook}'`))
  assertEquals(missing, [])
  assertEquals(styled.includes("[data-space$='rate-limit']"), true)
})

Deno.test('the stylesheet: is a valid stylesheet source, its name safe to become a file name', () => {
  assertEquals(iamCssSource.name, 'iam')
  assertEquals(/^[a-z0-9][a-z0-9-]*$/.test(iamCssSource.name), true)
  assertEquals(iamCssSource.css, IAM_UI_CSS)
})

Deno.test('the stylesheet: braces balance', () => {
  const opens = (IAM_UI_CSS.match(/\{/g) ?? []).length
  const closes = (IAM_UI_CSS.match(/\}/g) ?? []).length
  assertEquals(opens, closes)
})
