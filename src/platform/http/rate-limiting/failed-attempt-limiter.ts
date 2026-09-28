import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../../shared-kernel/index.js';
import type { EnvironmentVariables } from '../../config/environment.js';
import {
  parseRateLimit,
  type RateLimitValue,
} from '../../config/rate-limit-value.js';
import { ProblemException } from '../problem-details/problem.exception.js';

export type FailedAttemptLimit = 'login-email' | 'login-ip';

/** Past this many keys, expired ones are swept on the next failure, so memory stays bounded. */
const SWEEP_THRESHOLD = 10_000;

/**
 * Limits failed attempts rather than requests (ADR-0065, ADR-0102): 5 failed logins per email and 20 per IP
 * in 15 minutes by default. It slows down by time and never locks accounts. Counters live in memory, like
 * the request limits. Authentication (T-120) calls `assertAllowed` before checking credentials and
 * `recordFailure` when they are wrong.
 */
@Injectable()
export class FailedAttemptLimiter {
  private readonly limits: Record<FailedAttemptLimit, RateLimitValue>;
  /** Failure times per limit and hashed key, oldest first. */
  private readonly failures = new Map<string, number[]>();

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly clock: Clock,
  ) {
    this.limits = {
      'login-email': parseRateLimit(
        config.get('RATE_LIMIT_LOGIN_EMAIL', { infer: true }),
      ),
      'login-ip': parseRateLimit(
        config.get('RATE_LIMIT_LOGIN_IP', { infer: true }),
      ),
    };
  }

  /** @throws ProblemException `rate-limit-exceeded` with `Retry-After` while the key has too many failures. */
  assertAllowed(limit: FailedAttemptLimit, key: string): void {
    const recent = this.recentFailures(limit, key);
    const { limit: max, windowMs } = this.limits[limit];
    if (recent.length < max) return;
    const oldestExpiresAt = recent[recent.length - max] + windowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestExpiresAt - this.now()) / 1000),
    );
    throw new ProblemException(
      'rate-limit-exceeded',
      {},
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }

  recordFailure(limit: FailedAttemptLimit, key: string): void {
    if (this.failures.size > SWEEP_THRESHOLD) this.sweep();
    const recent = this.recentFailures(limit, key);
    this.failures.set(this.mapKey(limit, key), [...recent, this.now()]);
  }

  private recentFailures(limit: FailedAttemptLimit, key: string): number[] {
    const since = this.now() - this.limits[limit].windowMs;
    const mapKey = this.mapKey(limit, key);
    const recent = (this.failures.get(mapKey) ?? []).filter((at) => at > since);
    if (recent.length === 0) this.failures.delete(mapKey);
    return recent;
  }

  private sweep(): void {
    for (const mapKey of this.failures.keys()) {
      const [limit] = mapKey.split(':') as [FailedAttemptLimit];
      const since = this.now() - this.limits[limit].windowMs;
      const recent = (this.failures.get(mapKey) ?? []).filter(
        (at) => at > since,
      );
      if (recent.length === 0) this.failures.delete(mapKey);
    }
  }

  /** Keys are hashed, so no email or IP stays in memory as is. */
  private mapKey(limit: FailedAttemptLimit, key: string): string {
    const hash = createHash('sha256')
      .update(key.trim().toLowerCase())
      .digest('hex');
    return `${limit}:${hash}`;
  }

  private now(): number {
    return this.clock.now().getTime();
  }
}
