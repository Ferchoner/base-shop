import { type ExecutionContext, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerOptions } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../../config/environment.js';
import { parseRateLimit } from '../../config/rate-limit-value.js';
import { FailedAttemptLimiter } from './failed-attempt-limiter.js';
import { RATE_LIMITS_METADATA } from './rate-limit.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { rateLimitKey } from './rate-limit-keys.js';
import {
  DEFAULT_RATE_LIMIT,
  RATE_LIMITS,
  type RateLimitName,
} from './rate-limits.js';

/** Limits declared with `@RateLimit` on the handler or its controller. */
function limitsOf(context: ExecutionContext): readonly RateLimitName[] {
  const declared = (Reflect.getMetadata(
    RATE_LIMITS_METADATA,
    context.getHandler(),
  ) ??
    Reflect.getMetadata(RATE_LIMITS_METADATA, context.getClass()) ??
    []) as readonly RateLimitName[];
  return declared;
}

/**
 * One throttler per limit, reading its values from the environment (ADR-0102). Each counts per limit and
 * key, not per endpoint, so endpoints that share a limit share its budget.
 */
function buildThrottlers(
  config: ConfigService<EnvironmentVariables, true>,
): ThrottlerOptions[] {
  const defaultLimit = parseRateLimit(
    config.get('RATE_LIMIT_DEFAULT', { infer: true }),
  );
  const throttlers: ThrottlerOptions[] = [
    {
      name: DEFAULT_RATE_LIMIT,
      limit: defaultLimit.limit,
      ttl: defaultLimit.windowMs,
      skipIf: (context) => limitsOf(context).length > 0,
      getTracker: (request) => rateLimitKey('ip', request),
      generateKey: (_context, tracker, name) => `${name}|${tracker}`,
    },
  ];
  for (const [name, { variable, key }] of Object.entries(RATE_LIMITS)) {
    const value = parseRateLimit(config.get(variable, { infer: true }));
    throttlers.push({
      name,
      limit: value.limit,
      ttl: value.windowMs,
      skipIf: (context) => !limitsOf(context).includes(name as RateLimitName),
      getTracker: (request) => rateLimitKey(key, request),
      generateKey: (_context, tracker, throttlerName) =>
        `${throttlerName}|${tracker}`,
    });
  }
  return throttlers;
}

/**
 * Rate limiting with `@nestjs/throttler` and in-memory counters (ADR-0065, ADR-0102). The guard is global
 * and must run after authentication, so limits counted per user see who is calling.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: buildThrottlers(config),
        // Only Retry-After, set by the guard; the X-RateLimit-* headers are not part of the API.
        setHeaders: false,
      }),
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    FailedAttemptLimiter,
  ],
  exports: [FailedAttemptLimiter],
})
export class RateLimitingModule {}
