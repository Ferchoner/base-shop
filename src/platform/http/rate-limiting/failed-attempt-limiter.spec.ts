import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/environment.js';
import { ProblemException } from '../problem-details/problem.exception.js';
import { FailedAttemptLimiter } from './failed-attempt-limiter.js';

/** A clock the test moves by hand. */
class ManualClock {
  constructor(private current = new Date('2026-09-27T12:00:00.000Z')) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

function createLimiter(clock: ManualClock): FailedAttemptLimiter {
  const values: Partial<EnvironmentVariables> = {
    RATE_LIMIT_LOGIN_EMAIL: '3/15m',
    RATE_LIMIT_LOGIN_IP: '5/15m',
  };
  const config = {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new FailedAttemptLimiter(config, clock);
}

describe('FailedAttemptLimiter (ADR-0102)', () => {
  let clock: ManualClock;
  let limiter: FailedAttemptLimiter;

  beforeEach(() => {
    clock = new ManualClock();
    limiter = createLimiter(clock);
  });

  function failTimes(times: number, key = 'ana@example.com'): void {
    for (let attempt = 0; attempt < times; attempt++) {
      limiter.assertAllowed('login-email', key);
      limiter.recordFailure('login-email', key);
    }
  }

  it('allows attempts until the number of failures reaches the limit', () => {
    failTimes(3);

    expect(() =>
      limiter.assertAllowed('login-email', 'ana@example.com'),
    ).toThrow(ProblemException);
  });

  it('answers rate-limit-exceeded with Retry-After until the oldest failure leaves the window', () => {
    failTimes(3);
    clock.advance(5 * 60_000);

    let error: ProblemException | undefined;
    try {
      limiter.assertAllowed('login-email', 'ana@example.com');
    } catch (thrown) {
      error = thrown as ProblemException;
    }

    expect(error?.code).toBe('rate-limit-exceeded');
    expect(error?.headers['Retry-After']).toBe(String(10 * 60));
  });

  it('frees the key by time: accounts are never locked', () => {
    failTimes(3);
    clock.advance(15 * 60_000 + 1);

    expect(() =>
      limiter.assertAllowed('login-email', 'ana@example.com'),
    ).not.toThrow();
  });

  it('counts each key on its own, ignoring case and spaces in emails', () => {
    failTimes(3, 'Ana@Example.com ');

    expect(() =>
      limiter.assertAllowed('login-email', 'ana@example.com'),
    ).toThrow();
    expect(() =>
      limiter.assertAllowed('login-email', 'luis@example.com'),
    ).not.toThrow();
  });

  it('keeps separate budgets per limit', () => {
    failTimes(3);

    expect(() =>
      limiter.assertAllowed('login-ip', 'ana@example.com'),
    ).not.toThrow();
  });

  it('only counts failures: checking alone never blocks', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      limiter.assertAllowed('login-email', 'ana@example.com');
    }

    expect(() =>
      limiter.assertAllowed('login-email', 'ana@example.com'),
    ).not.toThrow();
  });
});
