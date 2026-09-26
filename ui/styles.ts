/**
 * @module
 *
 * The default stylesheet of `iam`'s views — the `./ui/styles` subpath. It styles every `data-space`
 * hook `iam`'s own markup emits (banners, the provider buttons, the one-time-code boxes, the
 * channel picker, the rate-limit card, the divider, the links and the password step) and nothing
 * else: a page or card wrapper, buttons and fields belong to the app's own design system.
 *
 * Text, not a file, so it ships through JSR and reaches a `@zanix/space` app through
 * `defineSpaceApp({ cssSources: [iamCssSource] })`; `@zanix/space` places it ahead of the app's own
 * `globalCss`. Consumers that render `iam`'s views with their own CSS, build their own UI on the
 * headless SDK, or only use the backend never import this module.
 *
 * **The app's CSS wins.** The stylesheet comes before the app's own, and its selectors are the
 * plain hook selectors a design system writes (`[data-space='x']`, or one descendant of it), so a
 * rule the app writes for the same hook with the same or more specificity overrides it, and it
 * beats the app's generic element rules (`input`, `select`, `a`), which it must. Values
 * read the design tokens the app already declares (`--space-color-*`, `--space-space-*`,
 * `--space-radius-*`) with a fallback, so an app usually restyles this by redeclaring a few tokens.
 * The tokens read are `--space-color-ink`, `-ink-muted`, `-border`, `-surface`, `-primary`,
 * `-primary-strong`, `-danger`, `-warning`, `-info` and `-success`.
 */

/** The stylesheet text. */
export const IAM_UI_CSS: string = String.raw`
[data-space='banner'] {
  display: flex;
  gap: var(--space-space-2xs, 0.5rem);
  align-items: flex-start;
  border-radius: var(--space-radius-sm, 0.375rem);
  border-left: 3px solid;
  padding: var(--space-space-xs, 0.5rem) var(--space-space-sm, 0.75rem);
  font-size: 0.875rem;
}
[data-space='banner'] svg {
  flex: none;
  margin-top: 0.0625rem;
}
[data-space='banner'][data-variant='error'] {
  background: color-mix(in srgb, var(--space-color-danger, #b91c1c) 12%, transparent);
  border-color: var(--space-color-danger, #b91c1c);
  color: var(--space-color-danger, #b91c1c);
}
[data-space='banner'][data-variant='warn'] {
  background: color-mix(in srgb, var(--space-color-warning, #b45309) 14%, transparent);
  border-color: var(--space-color-warning, #b45309);
  color: color-mix(in srgb, var(--space-color-warning, #b45309) 70%, var(--space-color-ink, #18181b));
}
[data-space='banner'][data-variant='info'] {
  background: color-mix(in srgb, var(--space-color-info, #1d4ed8) 12%, transparent);
  border-color: var(--space-color-info, #1d4ed8);
  color: var(--space-color-info, #1d4ed8);
}
[data-space='banner'][data-variant='success'] {
  background: color-mix(in srgb, var(--space-color-success, #15803d) 12%, transparent);
  border-color: var(--space-color-success, #15803d);
  color: color-mix(in srgb, var(--space-color-success, #15803d) 70%, var(--space-color-ink, #18181b));
}

[data-space='auth-description'] {
  margin: 0;
  text-align: center;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space='auth-hint'] {
  font-size: 0.875rem;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space='auth-divider'] {
  display: flex;
  align-items: center;
  gap: var(--space-space-2xs, 0.5rem);
  margin: var(--space-space-2xs, 0.5rem) 0;
  font-size: 0.8125rem;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space='auth-divider']::before,
[data-space='auth-divider']::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--space-color-border, #d4d4d8);
}
[data-space='auth-actions'] {
  display: flex;
  flex-direction: column;
  gap: var(--space-space-2xs, 0.5rem);
}
[data-space='auth-actions'] .btn {
  width: 100%;
}
[data-space='auth-actions'] a {
  text-align: center;
  text-decoration: none;
}
[data-space='auth-legal-links'] {
  margin: 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space='auth-legal-links'] a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
[data-space='auth-legal-links'] a:hover {
  color: var(--space-color-ink, #18181b);
}
[data-space='auth-back-link'] {
  margin: 0;
  text-align: center;
  font-size: 0.875rem;
}
[data-space='auth-back-link'] a {
  color: var(--space-color-primary-strong, #1d4ed8);
  text-decoration: none;
}
[data-space='auth-back-link'] a:hover,
[data-space='auth-back-link'] a:focus-visible {
  text-decoration: underline;
}

[data-space='auth-oauth-buttons'] {
  display: flex;
  flex-direction: column;
  gap: var(--space-space-2xs, 0.5rem);
}
[data-space='auth-oauth-buttons'] form {
  display: contents;
}
[data-space='auth-oauth-button'] {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-space-2xs, 0.5rem);
  min-height: 2.75rem;
  padding: 0 var(--space-space-lg, 1.25rem);
  border: 1px solid var(--space-color-border, #d4d4d8);
  border-radius: var(--space-radius-md, 0.5rem);
  background: var(--space-color-surface, #ffffff);
  color: var(--space-color-ink, #18181b);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--space-motion-fast, 120ms) var(--space-ease-warm, ease);
}
[data-space='auth-oauth-button']:hover {
  background: color-mix(
    in srgb,
    var(--space-color-ink, #18181b) 4%,
    var(--space-color-surface, #ffffff)
  );
}
[data-space='auth-oauth-button']:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--space-color-primary, #2563eb) 30%, transparent);
}
[data-space='auth-oauth-button'] svg {
  flex: none;
}
[data-space='auth-oauth-link'] {
  all: unset;
  cursor: pointer;
  color: var(--space-color-primary-strong, #1d4ed8);
  text-decoration: underline;
}

[data-login-step='password']:not([hidden]) {
  display: flex;
  flex-direction: column;
  gap: var(--space-space-sm, 0.75rem);
}

[data-space='otp-code-field'] {
  position: relative;
  width: max-content;
}
[data-space='otp-code-field-boxes'] {
  display: flex;
  gap: var(--space-space-2xs, 0.5rem);
}
[data-space='otp-code-field-box'] {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 3.25rem;
  border: 1.5px solid var(--space-color-border, #d4d4d8);
  border-radius: var(--space-radius-sm, 0.375rem);
  background: var(--space-color-surface, #ffffff);
  color: var(--space-color-ink, #18181b);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 1.375rem;
  font-weight: 700;
}
[data-space='otp-code-field-box'][data-active='true'] {
  border-color: var(--space-color-primary, #2563eb);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--space-color-primary, #2563eb) 22%, transparent);
}
[data-space='otp-code-field-box'][data-error='true'] {
  border-color: var(--space-color-danger, #b91c1c);
  color: var(--space-color-danger, #b91c1c);
}
[data-space='otp-code-field'] .otp-code-field-real-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding-left: 0.9rem;
  border: none;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--space-color-ink, #18181b);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 1.375rem;
  letter-spacing: 1.65rem;
}

[data-space='otp-resend-notifier-picker'] {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-space-3xs, 0.25rem);
  margin-bottom: var(--space-space-2xs, 0.5rem);
  font-size: 0.8125rem;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space='otp-resend-notifier-picker'] label {
  white-space: nowrap;
}
[data-space='otp-resend-notifier-picker'] select {
  display: inline-block;
  width: auto;
  padding: 0.25rem var(--space-space-xs, 0.5rem);
  padding-right: 1.75rem;
  border-radius: var(--space-radius-pill, 999px);
  background-color: color-mix(
    in srgb,
    var(--space-color-ink, #18181b) 4%,
    var(--space-color-surface, #ffffff)
  );
  color: var(--space-color-ink, #18181b);
  font-size: 0.8125rem;
}

[data-space$='rate-limit'] {
  margin-bottom: var(--space-space-md, 1rem);
}
[data-space='login-rate-limit-heading'] {
  margin: 0 0 var(--space-space-3xs, 0.25rem);
  font-weight: 600;
}
[data-space='login-rate-limit-body'] {
  margin: 0 0 var(--space-space-xs, 0.5rem);
  font-size: 0.875rem;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space$='rate-limit'] [data-space-ui='countdown'][data-variant='ring'] {
  display: flex;
  width: max-content;
  margin: 0 auto;
}

[data-space='otpauth-link'] {
  display: block;
  overflow-wrap: break-word;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 0.8125rem;
  color: var(--space-color-ink-muted, #52525b);
}
[data-space='otpauth-link']:hover,
[data-space='otpauth-link']:focus-visible {
  color: var(--space-color-ink, #18181b);
}
`

/**
 * {@linkcode IAM_UI_CSS} as a `@zanix/space` stylesheet source: pass it to
 * `defineSpaceApp({ cssSources })`. Declared here without importing that type, so this module
 * keeps no dependency on `@zanix/space`.
 */
export const iamCssSource: { readonly name: string; readonly css: string } = {
  name: 'iam',
  css: IAM_UI_CSS,
}
