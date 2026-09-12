# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`LoginView.privacyUrl`** — a Privacy Notice link rendered alongside the existing `termsUrl` one
  (`login/privacy-link` message key), independent of it: a host sets either, both, or neither.
  `undefined` renders no link, same purely-informational contract as `termsUrl`. This project's own
  default app wires it from a new `PRIVACY_NOTICE_URL_ENV` (`PRIVACY_NOTICE_URL`) env var, mirroring
  `TERMS_AND_CONDITIONS_URL_ENV` exactly.

### Changed

- **Documented the auto-linking risk surface in `AuthService.loginWithOTPCallback`**
  (`src/server/interactors/auth.interactor.ts`) — a code-only change, no behavior shift. A verified
  OTP for `email` always logs into whatever `auth` record already exists for that email, regardless
  of how that account originally authenticated (password, OAuth2, or a prior OTP signup); correct
  auto-linking today (zero real accounts, nothing to migrate), but a real account-takeover surface
  once an email-verification flow for a NEW method can complete without truly confirming the inbox
  owner. The comment flags it for whoever revisits this once that stops being true.
- **`cookieConsentBypassGuard` (`src/space/middleware.ts`) now delegates its actual header injection
  to `@zanix/auth`'s own `markCookiesAccepted`**, rather than hand-rolling it here. Behavior is
  unchanged (same real `ctx.req` clone, same immutable-`Headers`/frozen-`ctx.cookies`/
  already-consumed-`POST`-body handling, all still covered by this file's own existing tests) — this
  project's own implementation turned out to be the first of two independent, identical fixes for a
  generic `@zanix/auth` gap (a second consumer app's own `cookiesAcceptedGuard` needed the exact
  same mechanism shortly after), so the fix now lives once, upstream, instead of twice. Requires
  `@zanix/auth@^1.4.0`.
