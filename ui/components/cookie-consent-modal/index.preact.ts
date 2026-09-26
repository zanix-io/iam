import { h } from 'preact'
import type { VNode } from 'preact'
import { useState } from 'preact/hooks'
import { ConsentModal, useIntl } from '@zanix/space-ui/preact'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createCookieConsentModal } from './render.ts'
import type { CookieConsentModalProps } from './types.ts'

export type { CookieConsentModalProps }

/**
 * `iam`'s project-wide cookie-consent dialog — see `index.ts`'s own doc for the full description.
 * Preact binding, same props, same rendered markup; import from
 * `@zanix/iam/ui/components/cookie-consent-modal` for the React one.
 */
// Same overload-set cast `index.ts`'s own React binding uses — `h` is overloaded per-tag the same
// way `React.createElement` is.
export const CookieConsentModal: (props: CookieConsentModalProps) => VNode =
  createCookieConsentModal(
    h as unknown as CreateElement<VNode>,
    { useState },
    { ConsentModal, useIntl },
  )
