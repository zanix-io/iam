/**
 * @module
 *
 * Which delivery channel a pending one-time code travels on, and how a screen carries that choice
 * through its redirects. The channel lives in the URL's own query string rather than in a
 * server-side cache, so a reload, a second tab and the browser's back button always agree with
 * what the code screen shows.
 */

import { NOTIFIERS } from '../../src/utils/shared-enums.ts'

/** Every delivery channel a one-time code can use: the notifiers `iam` can dispatch through. */
export const OTP_CHANNELS: readonly ['email', 'sms', 'whatsapp'] = NOTIFIERS

/** A delivery channel of {@linkcode OTP_CHANNELS}. */
export type OtpChannel = typeof OTP_CHANNELS[number]

/** The query param a code screen reads and writes the current channel on. */
export const OTP_CHANNEL_PARAM = 'channel'

/** `undefined` for anything that is not exactly one of {@linkcode OTP_CHANNELS}: an absent param,
 * an empty string, or a stale or tampered value. */
export function parseOtpChannel(value: string | null | undefined): OtpChannel | undefined {
  return (OTP_CHANNELS as readonly string[]).includes(value ?? '')
    ? (value as OtpChannel)
    : undefined
}

/** The channel this request treats as current: a valid {@linkcode OTP_CHANNEL_PARAM} always wins,
 * else `accountDefault`. */
export function resolveOtpChannel(
  searchParams: URLSearchParams,
  accountDefault: OtpChannel,
): OtpChannel {
  return parseOtpChannel(searchParams.get(OTP_CHANNEL_PARAM)) ?? accountDefault
}

/** Appends `channel=<channel>` onto `path`, so the choice travels through a redirect. A no-op when
 * `channel` is `undefined`. */
export function withOtpChannelParam(path: string, channel: OtpChannel | undefined): string {
  if (!channel) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${OTP_CHANNEL_PARAM}=${channel}`
}

/** Every channel deliverable for an account: `'email'` always is, `'sms'` and `'whatsapp'` only
 * with a verified phone on file. */
export function deliverableOtpChannels(hasVerifiedPhone: boolean | undefined): OtpChannel[] {
  return hasVerifiedPhone ? [...OTP_CHANNELS] : ['email']
}

/**
 * The options of a channel picker: every deliverable channel for the account, labelled with the
 * message each key resolves to. A single option (no verified phone, the common case) means there is
 * nothing to pick, and the resend component renders no picker.
 * @param labelKeys - The message key of each channel's short name ("Email", "SMS", ...). The app
 * supplies its own, so the wording comes from its own catalog.
 */
export function buildOtpNotifierOptions(
  formatMessage: (key: string) => string,
  hasVerifiedPhone: boolean | undefined,
  labelKeys: Record<OtpChannel, string>,
): { value: OtpChannel; label: string }[] {
  return deliverableOtpChannels(hasVerifiedPhone).map((value) => ({
    value,
    label: formatMessage(labelKeys[value]),
  }))
}
