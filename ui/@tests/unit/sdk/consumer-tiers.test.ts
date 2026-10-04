import { assertEquals } from 'jsr:@std/assert@0.224'

/**
 * `iam` is consumed at three levels, and each may import only what it needs:
 *
 * - **Backend only**: `./auth-app`, `./grant-access-app`, `./shared-enums`. No UI file, no
 *   renderer, no `@zanix/space` in their module graph.
 * - **Headless SDK**: `./ui/sdk/messages` and the rest of `ui/sdk`, for a UI in any framework.
 *   The catalogs read as plain data.
 * - **Views** (`ui/pages`, `ui/components`, `ui/styles`): may use a renderer and `@zanix/space`.
 */

interface Graph {
  specifiers: string[]
  local: string[]
}

async function moduleGraph(entry: string): Promise<Graph> {
  const { stdout, stderr, success } = await new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!success) throw new Error(`deno info ${entry}: ${new TextDecoder().decode(stderr)}`)
  const parsed = JSON.parse(new TextDecoder().decode(stdout))
  const specifiers: string[] = parsed.modules.map((module: { specifier: string }) =>
    module.specifier
  )
  return {
    specifiers,
    local: specifiers.filter((specifier) => specifier.startsWith('file://')),
  }
}

const RENDERING_OR_SPACE = /preact|\/react|npm:react|@zanix\/space|space-ui/

for (
  const entry of [
    'src/server/apps/auth.app.ts',
    'src/server/apps/grant-access.app.ts',
    'src/utils/shared-enums.ts',
  ]
) {
  Deno.test(`backend only: ${entry} reaches no UI file, renderer or @zanix/space`, async () => {
    const graph = await moduleGraph(entry)
    assertEquals(graph.local.filter((specifier) => specifier.includes('/ui/')), [])
    assertEquals(graph.specifiers.filter((specifier) => RENDERING_OR_SPACE.test(specifier)), [])
  })
}

/** The module specifiers a file imports or re-exports, read from its own source. */
function importsOf(path: string): string[] {
  return [
    ...Deno.readTextFileSync(path).matchAll(/^(?:import|export)\b[^;]*?from\s+['"]([^'"]+)['"]/gms),
  ]
    .map((match) => match[1])
}

Deno.test('headless SDK: the catalogs read as plain data, importing nothing but each other', async () => {
  assertEquals(importsOf('ui/sdk/messages.ts').sort(), [
    './messages/compiled/en.ts',
    './messages/compiled/es.ts',
    './messages/en.ts',
    './messages/es.ts',
  ])
  for (const module of ['en', 'es', 'compiled/en', 'compiled/es']) {
    assertEquals(importsOf(`ui/sdk/messages/${module}.ts`), [], module)
  }
  const graph = await moduleGraph('ui/sdk/messages.ts')
  assertEquals(graph.specifiers.filter((specifier) => RENDERING_OR_SPACE.test(specifier)), [])
})

Deno.test('views: the default stylesheet is one self-contained module', async () => {
  assertEquals(importsOf('ui/styles.ts'), ['./styles.css'])
  assertEquals((await Deno.readTextFile('ui/styles.css')).match(/@import\b/g), null)
  const graph = await moduleGraph('ui/styles.ts')
  assertEquals(graph.specifiers.filter((specifier) => RENDERING_OR_SPACE.test(specifier)), [])
})

Deno.test('the catalogs and the stylesheet are published subpaths', () => {
  const exports = JSON.parse(Deno.readTextFileSync('deno.json')).exports
  assertEquals(exports['./ui/sdk/messages'], './ui/sdk/messages.ts')
  assertEquals(exports['./ui/styles'], './ui/styles.ts')
})
