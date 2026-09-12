/**
 * @module
 *
 * i18n message catalogs for a login/2FA/password-recovery UI — the `./sdk/messages` subpath.
 * Plain data (`Record<string, string>`), never a component — interpolate placeholders with
 * whatever templating a consumer's own i18n layer already uses. Only `en` exists today, mirroring
 * `iam`'s own current `src/space/messages/en/`; add a sibling export here if `iam` ever ships a
 * second locale.
 */
export { IAM_UI_MESSAGES_EN } from './messages/en.ts'
