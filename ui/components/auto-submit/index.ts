import { useEffect } from 'react'
import { defineComet } from '@zanix/space/comet'
import { attachAutoSubmit } from './attach.ts'
import type { AutoSubmitProps } from './types.ts'

export type { AutoSubmitProps }

/**
 * A form's own auto-submit-on-mount Comet — see `attach.ts`'s own doc for the full description.
 * Shared by every page that needs to skip a redundant click/re-entry a visitor already did on a
 * previous screen (`login-oauth-start` today). React binding; import from `./index.preact.ts` for
 * the Preact one.
 *
 * The raw, un-wrapped component is exported here too — same reasoning
 * `rate-limit-countdown/index.ts`'s own doc gives: what `defineComet` reads back on the client
 * after a dynamic import, and also directly usable for a real-DOM interaction test that needs no
 * server/hydrate round trip (this Comet's own test imports THIS, never the `default` boundary).
 */
export function AutoSubmit({ formId }: AutoSubmitProps): null {
  useEffect(() => attachAutoSubmit(formId), [formId])
  return null
}

export default defineComet(AutoSubmit, import.meta.url, 'AutoSubmit')
