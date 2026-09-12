import type { IntlMessages } from '@zanix/space-ui'
import type { CreateElement } from 'ui/typings/renderer.ts'
import type { LangLayoutViewProps } from './types.ts'

/**
 * Builds the `<IntlProvider>` element, injected alongside `h` — `index.ts`/`index.preact.ts` each
 * supply their own real `createElement(IntlProvider, ...)`/`h(IntlProvider, ...)` call. Unlike
 * `Button`/`Field`/`Input` elsewhere in this package (plain, hook-free functions, safe to call
 * directly), `IntlProvider` calls a real hook (`useMemo`) internally — invoking it directly, as a
 * bare function call outside an actual render pass, throws "Invalid hook call". Deferring the real
 * element-construction call to `index.ts`/`index.preact.ts` (where the renderer's own real
 * `createElement`/`h` — not this file's narrower, string-tag-only {@linkcode CreateElement}
 * type — can reference `IntlProvider` as a component, never invoking it eagerly) is what keeps
 * this file itself free of that renderer-specific mechanics.
 */
export type LangLayoutDeps<Children, E> = {
  renderIntlProvider: (
    locale: string,
    messages: IntlMessages,
    children: Array<E | Children | null>,
  ) => E
}

/**
 * The real implementation of `iam`'s root document shell, shared identically between the React
 * and Preact bindings (`index.ts`/`index.preact.ts`) — parametrized by `h` plus
 * {@linkcode LangLayoutDeps}. This file never imports React, Preact, `@zanix/space-ui`, or
 * `@zanix/space` at runtime.
 *
 * Deliberately never imports the cookie-consent Comet itself: a Comet is resolved by real file
 * path via `@zanix/space`'s own manifest, one file per app — there is no dual-renderer "the"
 * cookie-consent Comet this package could inject the way it injects `Button`/`Field`/`IntlProvider`.
 * Instead, `data.cookieConsentSlot` arrives as an ALREADY-BUILT element (or `null`/`undefined`) —
 * the owning `@zanix/space` route builds it from ITS OWN real comet module (see `iam`'s own
 * `routes/[lang]/layout.tsx`) and hands the result down, the same render-prop/slot technique
 * `@zanix/space-ui`'s own `Menu.visual` uses to avoid a static cross-package import it can't
 * always afford.
 *
 * This is the actual `<html>`/`<body>` document for every real page in `iam` — with no root
 * `routes/layout.tsx` above it, `@zanix/space` wraps only whatever falls OUTSIDE this `[lang]/...`
 * segment in its own minimal default document instead.
 */
export function createLangLayout<Children, E>(
  h: CreateElement<E>,
  deps: LangLayoutDeps<Children, E>,
): (props: LangLayoutViewProps<Children, E>) => E {
  const { renderIntlProvider } = deps

  return function LangLayout({ children, data }: LangLayoutViewProps<Children, E>): E {
    return h(
      'html',
      { lang: data.lang },
      h(
        'head',
        null,
        h('meta', { charSet: 'utf-8' }),
        h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      ),
      h(
        'body',
        null,
        renderIntlProvider(data.lang, data.messages, [data.cookieConsentSlot ?? null, children]),
      ),
    )
  }
}
