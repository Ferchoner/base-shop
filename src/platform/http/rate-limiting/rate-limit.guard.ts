import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ProblemException } from '../problem-details/problem.exception.js';

/** Payment provider webhooks, protected by their signature instead (ADR-0071). */
const WEBHOOKS_PATH = /^\/v\d+\/webhooks(\/|$)/;

/**
 * `@nestjs/throttler` guard with the rules of ADR-0065 and ADR-0102: webhooks are never limited, and an
 * exceeded limit answers `rate-limit-exceeded` as Problem Details with `Retry-After` in seconds.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ originalUrl?: string; url: string }>();
    const path = (request.originalUrl ?? request.url).split('?')[0];
    return Promise.resolve(WEBHOOKS_PATH.test(path));
  }

  protected throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ProblemException(
      'rate-limit-exceeded',
      {},
      { 'Retry-After': String(Math.max(1, detail.timeToBlockExpire)) },
    );
  }
}
