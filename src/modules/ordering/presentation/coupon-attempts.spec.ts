import type { FailedAttemptLimiter } from '../../../platform/http/rate-limiting/failed-attempt-limiter.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import {
  CouponNotApplicableError,
  EmptyCartError,
} from '../domain/ordering-errors.js';
import { withCouponAttempts } from './coupon-attempts.js';

/** A limiter that records what it is asked, and refuses once `blocked`. */
function limiter(blocked = false) {
  const calls: string[] = [];
  const attempts = {
    assertAllowed: (limit: string, key: string) => {
      calls.push(`check ${limit} ${key}`);
      if (blocked) {
        throw new ProblemException('rate-limit-exceeded');
      }
    },
    recordFailure: (limit: string, key: string) => {
      calls.push(`fail ${limit} ${key}`);
    },
  } as unknown as FailedAttemptLimiter;
  return { attempts, calls };
}

const request = { ip: '203.0.113.7' };

describe('withCouponAttempts (ADR-0168)', () => {
  it('runs a request without a coupon without asking the limiter', async () => {
    const { attempts, calls } = limiter(true);

    expect(
      await withCouponAttempts(attempts, request, undefined, () =>
        Promise.resolve(1),
      ),
    ).toBe(1);
    expect(
      await withCouponAttempts(attempts, request, null, () =>
        Promise.resolve(2),
      ),
    ).toBe(2);
    expect(calls).toEqual([]);
  });

  it('checks the IP before a request with a coupon, and counts nothing when it applies', async () => {
    const { attempts, calls } = limiter();

    expect(
      await withCouponAttempts(attempts, request, 'HOLA', () =>
        Promise.resolve('ok'),
      ),
    ).toBe('ok');
    expect(calls).toEqual(['check coupon ip:203.0.113.7']);
  });

  it('counts a code nobody has, which answers unavailable, by IP', async () => {
    const { attempts, calls } = limiter();
    const refused = new CouponNotApplicableError('unavailable');

    await expect(
      withCouponAttempts(attempts, request, 'NADIE', () =>
        Promise.reject(refused),
      ),
    ).rejects.toBe(refused);
    expect(calls).toEqual([
      'check coupon ip:203.0.113.7',
      'fail coupon ip:203.0.113.7',
    ]);
  });

  it('never counts another refusal of the coupon, nor another error', async () => {
    const { attempts, calls } = limiter();

    for (const error of [
      new CouponNotApplicableError('exhausted'),
      new CouponNotApplicableError('alreadyUsed'),
      new EmptyCartError(),
    ]) {
      await expect(
        withCouponAttempts(attempts, request, 'HOLA', () =>
          Promise.reject(error),
        ),
      ).rejects.toBe(error);
    }
    expect(calls.filter((call) => call.startsWith('fail'))).toEqual([]);
  });

  it('refuses a request with a coupon once the IP has too many, without running it', async () => {
    const { attempts } = limiter(true);
    let ran = false;

    await expect(
      withCouponAttempts(attempts, request, 'HOLA', () => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toMatchObject({ code: 'rate-limit-exceeded' });
    expect(ran).toBe(false);
  });
});
