import { assertEquals } from 'jsr:@std/assert@0.224'
import { h } from 'preact'
import { render } from 'preact-render-to-string'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { providerIcon, providerLabel } from '../../../pages/provider-display.ts'

const create = h as unknown as CreateElement<ReturnType<typeof h>>

Deno.test('providerLabel: the brand spelling of a known provider, a capitalised code otherwise', () => {
  assertEquals(providerLabel('google'), 'Google')
  assertEquals(providerLabel('github'), 'GitHub')
  assertEquals(providerLabel('gitlab'), 'Gitlab')
  assertEquals(providerLabel(''), '')
})

Deno.test('providerIcon: Google gets an inline mark that needs no stylesheet, no other provider does', () => {
  const html = render(providerIcon(create, 'google') as never)
  assertEquals(html.startsWith('<svg'), true)
  assertEquals(html.includes('data-space="auth-provider-icon"'), true)
  assertEquals(html.includes('aria-hidden="true"'), true)
  assertEquals(html.includes('width="18"'), true)
  assertEquals(html.includes('style='), false)
  assertEquals(html.match(/<path/g)?.length, 4)
  assertEquals(providerIcon(create, 'github'), null)
})
