/**
 * English message catalog for a consumer building its own login/2FA/password-recovery UI —
 * mirrors `iam/src/space/messages/en/index.json`'s own login/OTP/TOTP/password-recovery/logout
 * strings verbatim (same keys, same text), minus its `consent/*` entries: cookie consent is a
 * page-level concern of `iam`'s own hosted UI (`POST /{lang}/consent`, backed by a `@zanix/space`
 * page action, not a REST endpoint any external host calls), out of this SDK's scope.
 *
 * Plain data, renderer-agnostic — interpolate `{token}` placeholders (e.g. `{email}`, `{provider}`)
 * with whatever templating a consumer's own i18n layer already uses.
 */
export const IAM_UI_MESSAGES_EN: Readonly<Record<string, string>> = {
  'login/invalid-credentials': 'Invalid email or password.',
  'login/rate-limited': 'Too many attempts — please wait a minute and try again.',
  'login/unexpected-error': 'Something went wrong signing you in. Please try again.',
  'login/email-label': 'Email',
  'login/password-label': 'Password',
  'login/submit': 'Sign in',
  'login/terms-link': 'Terms and Conditions',
  'login/oauth-continue': 'Continue with {provider}',

  'common/back-to-sign-in': 'Back to sign in',
  'common/verify': 'Verify',
  'common/invalid-or-expired-code': 'Invalid or expired code.',
  'common/try-again': 'Try again',

  'login/otp/heading': 'Enter your verification code',
  'login/otp/sent-to': 'A verification code was sent for {email}.',
  'login/otp/code-label': 'Verification code',

  'login/totp/heading': 'Enter your authenticator code',
  'login/totp/signing-in-as': 'Signing in as {email}.',
  'login/totp/invalid-code': 'Invalid authenticator code.',
  'login/totp/code-label': 'Authenticator code',

  'totp/confirm/heading': 'Confirm authenticator app',

  'totp/enroll/heading': 'Set up an authenticator app',
  'totp/enroll/invalid-code': 'Invalid authenticator code — scan the new code below.',
  'totp/enroll/scan-aria-label': 'Scan this QR code with your authenticator app',
  'totp/enroll/scan-instructions':
    'Scan this in your authenticator app, or enter the key manually:',
  'totp/enroll/code-label': 'Authenticator code',
  'totp/enroll/submit': 'Confirm',

  'login/oauth/callback-heading': 'Signed in',
  'login/oauth/callback-continue': 'Continue',
  'login/oauth/error-heading': "Sign-in didn't complete",
  'login/oauth/error-body':
    'Something went wrong finishing sign-in. You can try again from the sign-in page.',

  'logout/heading': 'Sign out',
  'logout/submit': 'Sign out',

  'password/recovery/request-heading': 'Check your email',
  'password/recovery/request-body':
    'If an account exists for {email}, a recovery code has been sent.',
  'password/recovery/have-code-link': 'I have my code',
  'password/recovery/callback-heading': 'Reset your password',
  'password/recovery/code-label': 'Recovery code',
  'password/recovery/password-label': 'New password',
  'password/recovery/submit': 'Reset password',
}
