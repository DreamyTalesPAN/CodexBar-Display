// Every reset countdown in the Control Center goes through here. A countdown
// arrives as the seconds that were left when it was read: when usage was
// collected, or when the frame was sent to VibeTV. The reset moment is that
// instant plus those seconds, so what is left now depends on the current time.
// Showing the seconds as read made the Usage page say 26m while 23.7 minutes
// were left and the Overview said 23m.

/** Whole seconds since `at`; 0 when `at` is unknown or still ahead. */
export function secondsSince(at: string | undefined, now: Date): number {
  const then = at ? new Date(at).getTime() : Number.NaN;
  return Number.isNaN(then)
    ? 0
    : Math.max(0, Math.floor((now.getTime() - then) / 1000));
}

/** Seconds left now of a countdown that stood at `resetSecs` at `readAt`. */
export function remainingResetSecs(
  resetSecs: number | undefined,
  readAt: string | undefined,
  now: Date,
): number {
  return Math.max(0, (resetSecs ?? 0) - secondsSince(readAt, now));
}

/** "23m", "2h 14m", "1d 3h": whole minutes rounded down, as VibeTV draws them. */
export function formatResetCountdown(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
