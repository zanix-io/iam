import { assertEquals } from 'jsr:@std/assert@0.224'

import { defineSeeders } from 'utils/seeders.ts'

/** Pure function, no DI/registration involved — correctly `unit/` per
 * `zanix-test-tier-conventions`. */

Deno.test('defineSeeders: includes both prod and dev seeders outside production', () => {
  const original = Deno.env.get('ENV')
  Deno.env.set('ENV', 'development')
  try {
    const result = defineSeeders(['prod-a'], ['dev-a', 'dev-b'])
    assertEquals(result, ['prod-a', 'dev-a', 'dev-b'])
  } finally {
    if (original === undefined) Deno.env.delete('ENV')
    else Deno.env.set('ENV', original)
  }
})

Deno.test('defineSeeders: includes both prod and dev seeders when ENV is entirely unset', () => {
  const original = Deno.env.get('ENV')
  Deno.env.delete('ENV')
  try {
    const result = defineSeeders(['prod-a'], ['dev-a'])
    assertEquals(result, ['prod-a', 'dev-a'])
  } finally {
    if (original !== undefined) Deno.env.set('ENV', original)
  }
})

Deno.test('defineSeeders: excludes dev seeders in production', () => {
  const original = Deno.env.get('ENV')
  Deno.env.set('ENV', 'production')
  try {
    const result = defineSeeders(['prod-a', 'prod-b'], ['dev-a'])
    assertEquals(result, ['prod-a', 'prod-b'])
  } finally {
    if (original === undefined) Deno.env.delete('ENV')
    else Deno.env.set('ENV', original)
  }
})
