import type { FailedAttemptLimiter } from '../../../platform/http/rate-limiting/failed-attempt-limiter.js';
import { rateLimitKey } from '../../../platform/http/rate-limiting/rate-limit-keys.js';
import { DomainError } from '../../../shared-kernel/index.js';

/**
 * Runs a quote or an order that may bring a coupon, limiting the codes nobody has by IP (ADR-0168): checked before it
 * runs, and recorded when the coupon answers `unavailable`, which is how an unknown code answers. Other refusals, and
 * requests without a coupon, never count.
 *
 * @throws ProblemException `rate-limit-exceeded` with `Retry-After` while the IP has too many.
 */
export async function withCouponAttempts<T>(
  attempts: FailedAttemptLimiter,
  request: { ip?: string },
  couponCode: string | null | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (couponCode === undefined || couponCode === null) return work();
  const ip = rateLimitKey('ip', request);
  attempts.assertAllowed('coupon', ip);
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.code === 'coupon-not-applicable' &&
      error.details?.reason === 'unavailable'
    ) {
      attempts.recordFailure('coupon', ip);
    }
    throw error;
  }
}
