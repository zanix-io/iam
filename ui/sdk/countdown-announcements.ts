/**
 * The three screen-reader texts a `Countdown` announces, as plain strings. `Countdown`
 * (`@zanix/space-ui` >= 2.9.4) does not translate: it takes these props and falls back to English
 * when one is missing. A Comet only receives serializable props from the server, so the host
 * resolves each text and passes it through, the same contract as every other label of
 * `RateLimitCountdown` and `OtpResend`.
 */
export type CountdownAnnouncementProps = {
  /** Announced when the countdown ends, e.g. "Time's up". */
  announcementDone?: string
  /** Announced during the last minute, e.g. "Less than a minute remaining". */
  announcementLessThanMinute?: string
  /** Announced every minute before that; the literal `{minutes}` marker is replaced by the
   * remaining whole minutes, e.g. "{minutes} minutes remaining". */
  announcementMinutes?: string
}

/**
 * Resolves the three announcement texts from `iam`'s catalog (`login/countdown/announcement-*`).
 * `{minutes}` reaches the component literally: the catalog escapes it (`'{minutes}'`), so the
 * formatter never treats it as an ICU argument.
 *
 * @param formatMessage The page's `useIntl().formatMessage`.
 */
export function countdownAnnouncements(
  formatMessage: (id: string) => string,
): Required<CountdownAnnouncementProps> {
  return {
    announcementDone: formatMessage('login/countdown/announcement-done'),
    announcementLessThanMinute: formatMessage('login/countdown/announcement-less-than-minute'),
    announcementMinutes: formatMessage('login/countdown/announcement-minutes'),
  }
}
