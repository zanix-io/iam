import { useEffect } from 'preact/hooks'
import { defineComet } from '@zanix/space/comet'
import { attachAutoSubmit } from './attach.ts'
import type { AutoSubmitProps } from './types.ts'

export type { AutoSubmitProps }

/** A form's own auto-submit-on-mount Comet — see `index.ts`'s own doc, including why the raw
 * component is exported here too. Preact binding, identical behavior. */
export function AutoSubmit({ formId }: AutoSubmitProps): null {
  useEffect(() => attachAutoSubmit(formId), [formId])
  return null
}

export default defineComet(AutoSubmit, import.meta.url, 'AutoSubmit')
