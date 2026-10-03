/** Minutes to wait after each failed attempt of a delivery: 1, 5 and 15 minutes, then 1, 3, 6 and 12 hours (ADR-0150). */
const RETRY_DELAY_MINUTES = [1, 5, 15, 60, 180, 360, 720] as const;

/** Attempts of a delivery, the first one right after the commit: about 22 hours of retries in all (ADR-0150). */
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAY_MINUTES.length + 1;

/** How long a delivery stays with whoever took it; past it, an attempt that never finished can be taken again. */
export const DELIVERY_LEASE_MS = 5 * 60_000;

/** Deliveries one run of the retry job takes at most; the rest wait for the next minute. */
export const DELIVERY_BATCH_SIZE = 100;

/**
 * When a delivery that failed its attempt number `attempts` is tried again, or `null` when it has no attempts left.
 * A new delivery waits as if its first attempt failed, so the retry job leaves it to the dispatch after the commit.
 */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = RETRY_DELAY_MINUTES[Math.max(attempts, 1) - 1];
  return new Date(now.getTime() + minutes * 60_000);
}
