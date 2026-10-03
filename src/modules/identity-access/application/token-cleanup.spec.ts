import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { SpentTokens, TokenCleanup } from './token-cleanup.js';

const NOW = new Date('2026-10-31T09:00:00.000Z');
const THIRTY_DAYS_AGO = new Date('2026-10-01T09:00:00.000Z');

/** Tokens in memory: how many of each kind there are, and what each call asked. */
class SomeTokens extends SpentTokens {
  readonly asked: [string, Date, number][] = [];

  constructor(
    private readonly counts: { refresh: number; verify: number; reset: number },
    private readonly failing: string | null = null,
  ) {
    super();
  }

  deleteRefreshTokens(before: Date, limit: number): Promise<number> {
    return this.take('refresh', before, limit);
  }

  deleteEmailVerificationTokens(now: Date, limit: number): Promise<number> {
    return this.take('verify', now, limit);
  }

  deletePasswordResetTokens(now: Date, limit: number): Promise<number> {
    return this.take('reset', now, limit);
  }

  private take(
    kind: 'refresh' | 'verify' | 'reset',
    at: Date,
    limit: number,
  ): Promise<number> {
    this.asked.push([kind, at, limit]);
    if (this.failing === kind) return Promise.reject(new Error('lost'));
    const deleted = Math.min(limit, this.counts[kind]);
    this.counts[kind] -= deleted;
    return Promise.resolve(deleted);
  }
}

describe('TokenCleanup (UC-SYS-01, ADR-0029, ADR-0144)', () => {
  let log: jest.SpiedFunction<Logger['log']>;
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes refresh tokens spent 30 days ago and links that no longer work now, in batches, and logs how many', async () => {
    const tokens = new SomeTokens({ refresh: 1_200, verify: 3, reset: 0 });

    const report = await new TokenCleanup(tokens, { now: () => NOW }, 30).run();

    expect(report).toEqual({
      refreshTokens: 1_200,
      emailVerificationTokens: 3,
      passwordResetTokens: 0,
    });
    expect(tokens.asked).toEqual([
      ['refresh', THIRTY_DAYS_AGO, 1_000],
      ['refresh', THIRTY_DAYS_AGO, 1_000],
      ['verify', NOW, 1_000],
      ['reset', NOW, 1_000],
    ]);
    expect(log).toHaveBeenCalledWith(
      'Deleted 1200 refresh tokens, 3 email verification tokens and 0 password reset tokens',
    );
  });

  it('keeps spent refresh tokens the days of SPENT_REFRESH_TOKEN_RETENTION_DAYS (ADR-0149)', async () => {
    const tokens = new SomeTokens({ refresh: 0, verify: 0, reset: 0 });

    await new TokenCleanup(tokens, { now: () => NOW }, 90).run();

    expect(tokens.asked[0]).toEqual([
      'refresh',
      new Date('2026-08-02T09:00:00.000Z'),
      1_000,
    ]);
  });

  it('goes on with the other kinds when one fails, which the log tells', async () => {
    const tokens = new SomeTokens(
      { refresh: 2, verify: 1, reset: 1 },
      'verify',
    );

    const report = await new TokenCleanup(tokens, { now: () => NOW }, 30).run();

    expect(report).toEqual({
      refreshTokens: 2,
      emailVerificationTokens: null,
      passwordResetTokens: 1,
    });
    expect(error).toHaveBeenCalledWith(
      'The cleanup of email verification tokens failed',
      expect.stringContaining('lost'),
    );
  });
});
