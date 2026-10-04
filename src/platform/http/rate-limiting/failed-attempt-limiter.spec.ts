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
    RATE_LIMIT_LOGIN_IP: '5/15m',
    RATE_LIMIT_PASSWORD_CHANGE: '3/15m',
  };
  const config = {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new FailedAttemptLimiter(config, clock);
}

describe('FailedAttemptLimiter (ADR-0102, ADR-0154)', () => {
  let clock: ManualClock;
  let limiter: FailedAttemptLimiter;

  beforeEach(() => {
    clock = new ManualClock();
    limiter = createLimiter(clock);
  });

  const USER = '0199a0c1-0000-7000-8000-000000000001';

  function failTimes(times: number, key = USER): void {
    for (let attempt = 0; attempt < times; attempt++) {
      limiter.assertAllowed('password-change', key);
      limiter.recordFailure('password-change', key);
    }
  }

  it('allows attempts until the number of failures reaches the limit', () => {
    failTimes(3);

    expect(() => limiter.assertAllowed('password-change', USER)).toThrow(
      ProblemException,
    );
  });

  it('answers rate-limit-exceeded with Retry-After until the oldest failure leaves the window', () => {
    failTimes(3);
    clock.advance(5 * 60_000);

    let error: ProblemException | undefined;
    try {
      limiter.assertAllowed('password-change', USER);
    } catch (thrown) {
      error = thrown as ProblemException;
    }

    expect(error?.code).toBe('rate-limit-exceeded');
    expect(error?.headers['Retry-After']).toBe(String(10 * 60));
  });

  it('frees the key by time: accounts are never locked', () => {
    failTimes(3);
    clock.advance(15 * 60_000 + 1);

    expect(() => limiter.assertAllowed('password-change', USER)).not.toThrow();
  });

  it('counts each key on its own, ignoring case and spaces', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      limiter.recordFailure('login-ip', 'ip:2001:DB8::1 ');
    }

    expect(() => limiter.assertAllowed('login-ip', 'ip:2001:db8::1')).toThrow();
    expect(() =>
      limiter.assertAllowed('login-ip', 'ip:2001:db8::2'),
    ).not.toThrow();
  });

  it('keeps separate budgets per limit', () => {
    failTimes(3);

    expect(() => limiter.assertAllowed('login-ip', USER)).not.toThrow();
  });

  it('only counts failures: checking alone never blocks', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      limiter.assertAllowed('password-change', USER);
    }

    expect(() => limiter.assertAllowed('password-change', USER)).not.toThrow();
  });
});
