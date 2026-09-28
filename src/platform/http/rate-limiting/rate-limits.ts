import type { EnvironmentVariables } from '../../config/environment.js';
import type { RateLimitKey } from './rate-limit-keys.js';

/**
 * Specific limits of ADR-0065 counted per request (ADR-0102). An endpoint takes one or more with
 * `@RateLimit(...)`; endpoints without one get `default`. The failed-login limits are not here: they count
 * failures, not requests (FailedAttemptLimiter).
 */
export const RATE_LIMITS = {
  register: { variable: 'RATE_LIMIT_REGISTER', key: 'ip' },
  'password-reset-email': {
    variable: 'RATE_LIMIT_PASSWORD_RESET_EMAIL',
    key: 'email',
  },
  'password-reset-ip': { variable: 'RATE_LIMIT_PASSWORD_RESET_IP', key: 'ip' },
  'email-verification': {
    variable: 'RATE_LIMIT_EMAIL_VERIFICATION',
    key: 'user-or-email',
  },
  'guest-order': { variable: 'RATE_LIMIT_GUEST_ORDER', key: 'ip' },
  'place-order': { variable: 'RATE_LIMIT_PLACE_ORDER', key: 'user-or-cart' },
} as const satisfies Record<
  string,
  { variable: keyof EnvironmentVariables; key: RateLimitKey }
>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** The limit of every endpoint without a specific one: requests per IP. */
export const DEFAULT_RATE_LIMIT = 'default';
