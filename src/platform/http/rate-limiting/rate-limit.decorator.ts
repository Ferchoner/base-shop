import { SetMetadata } from '@nestjs/common';
import type { RateLimitName } from './rate-limits.js';

export const RATE_LIMITS_METADATA = Symbol('rate-limits');

/**
 * Applies specific limits of ADR-0065 to an endpoint, on top of the default one per IP (ADR-0102, ADR-0154). Each
 * limit is a budget per key shared by every endpoint that uses it; for example, guest order lookup and reorder share
 * `guest-order` per IP.
 *
 * ```ts
 * @Post('password-reset/request')
 * @RateLimit('password-reset-email', 'password-reset-ip')
 * ```
 */
export function RateLimit(
  ...limits: [RateLimitName, ...RateLimitName[]]
): MethodDecorator & ClassDecorator {
  return SetMetadata(RATE_LIMITS_METADATA, limits);
}
