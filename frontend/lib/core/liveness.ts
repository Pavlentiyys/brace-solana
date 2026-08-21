/**
 * Whether the thing that is supposed to be watching is actually watching.
 *
 * PLATFORM.md 2.5 makes this obligatory and says why: if the watcher stops, the user
 * has to learn it from the interface rather than from a liquidation. Acceptance in
 * section 7 fixes the outer bound at sixty seconds.
 *
 * So the interface degrades in two steps rather than one. A watcher holding a
 * subscription to the obligation reports every few seconds; twenty seconds of
 * silence is already abnormal and is worth showing, while sixty is the point at
 * which the panel has to stop claiming the position is being watched at all.
 *
 * The price feed gets the same treatment for the reason in section 6: a stale price
 * means every number on the panel is a number about the past.
 */

export const WATCHER_LAGGING_SECONDS = 20;
export const WATCHER_STALLED_SECONDS = 60;

/** Section 6: past this the panel carries a banner about possible inaccuracy. */
export const PRICE_STALE_SECONDS = 60;

export type LivenessState = "fresh" | "lagging" | "stalled" | "unknown";

export interface Liveness {
  state: LivenessState;
  /** Seconds since the last check. `null` when there has never been one. */
  secondsAgo: number | null;
}

/**
 * `lastCheckAt` of `null` is "we have not heard from it", which is not the same as
 * "it is fine" and is not the same as "it is down". It reads as unknown and the
 * panel says so.
 *
 * A timestamp in the future is treated as fresh rather than as an error. Clock skew
 * between the watcher's host and the reader's browser is normal and a couple of
 * seconds of it should not raise an alarm.
 */
export function watcherLiveness(lastCheckAt: number | null, now: number): Liveness {
  if (lastCheckAt === null) return { state: "unknown", secondsAgo: null };

  const secondsAgo = Math.max(0, Math.round(now - lastCheckAt));
  if (secondsAgo >= WATCHER_STALLED_SECONDS) return { state: "stalled", secondsAgo };
  if (secondsAgo >= WATCHER_LAGGING_SECONDS) return { state: "lagging", secondsAgo };
  return { state: "fresh", secondsAgo };
}

export function priceIsStale(publishedAt: number, now: number): boolean {
  return now - publishedAt >= PRICE_STALE_SECONDS;
}

/**
 * "4 seconds ago". Whole seconds under a minute, then minutes, then hours: the
 * panel's liveness line is read at a glance and "251 seconds ago" is arithmetic.
 */
export function agoLabel(secondsAgo: number | null): string {
  if (secondsAgo === null) return "never";
  if (secondsAgo < 1) return "just now";
  if (secondsAgo === 1) return "1 second ago";
  if (secondsAgo < 60) return `${secondsAgo} seconds ago`;

  const minutes = Math.floor(secondsAgo / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

/** Countdown for the authorization clock: "29 days", "6 hours", "12 minutes". */
export function durationLabel(seconds: number): string {
  if (seconds <= 0) return "expired";

  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return days === 1 ? "1 day" : `${days} days`;

  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;

  const minutes = Math.max(1, Math.floor(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
