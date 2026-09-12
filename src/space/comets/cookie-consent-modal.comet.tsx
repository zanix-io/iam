'use comet'

import { defineComet } from '@zanix/space/comet'
import { CookieConsentModal } from 'ui/components/cookie-consent-modal/index.ts'
import type { CookieConsentModalProps } from 'ui/components/cookie-consent-modal/index.ts'

/**
 * This project's own project-wide cookie-consent dialog — the Comet boundary itself (`'use
 * comet'`, `defineComet`, `import.meta.url`) is the one piece that genuinely has to live here,
 * inside `iam`'s own project: a Comet resolves by file path through `@zanix/space`'s own
 * per-app manifest, one file per app, with no dual-renderer "the" Comet to import the way a plain
 * component is — see `ui/components/cookie-consent-modal/render.ts`'s own doc for the full
 * behavioral description and why THAT file, not this one, owns the real implementation.
 *
 * `CookieConsentModal` itself is `@zanix/iam/ui/components/cookie-consent-modal`'s React binding
 * — this file adds no logic of its own beyond wrapping it for hydration, so `iam`'s own rendered
 * dialog and whatever a host importing that binding directly gets never drift apart.
 */
const cookieConsentModalComet: ReturnType<typeof defineComet<CookieConsentModalProps>> =
  defineComet(CookieConsentModal, import.meta.url)

export default cookieConsentModalComet
