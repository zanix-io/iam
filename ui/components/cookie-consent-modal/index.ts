import { createElement, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Modal } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import { createCookieConsentModal } from './render.ts'
import type { CookieConsentModalProps } from './types.ts'

export type { CookieConsentModalProps }

/**
 * `iam`'s project-wide cookie-consent dialog — see `render.ts`'s own doc for the full behavioral
 * description. React binding — import from `@zanix/iam/ui/components/cookie-consent-modal/preact`
 * for the Preact one. `iam`'s own comet wrapper (`space/comets/cookie-consent-modal.comet.tsx`)
 * assigns this directly to `defineComet`; a host embedding this component standalone renders it
 * the same way any other React component renders.
 */
// Same overload-set cast `@zanix/space-ui`'s own component bindings use — see
// `pages/login/index.ts`'s own identical doc for the full reasoning.
export const CookieConsentModal: (props: CookieConsentModalProps) => ReactElement =
  createCookieConsentModal(
    createElement as unknown as CreateElement<ReactElement>,
    { useState },
    { Button, Modal },
  )
