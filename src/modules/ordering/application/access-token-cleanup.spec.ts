import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  AccessTokenCleanup,
  SpentAccessTokens,
} from './access-token-cleanup.js';

const NOW = new Date('2026-10-31T09:00:00.000Z');

class SomeTokens extends SpentAccessTokens {
  readonly asked: [Date, number][] = [];

  constructor(private left: number) {
    super();
  }

  delete(now: Date, limit: number): Promise<number> {
    this.asked.push([now, limit]);
    const deleted = Math.min(limit, this.left);
    this.left -= deleted;
    return Promise.resolve(deleted);
  }
}

describe('AccessTokenCleanup (UC-SYS-01, ADR-0144, ADR-0148)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes the access links that no longer work by now, in batches, and logs how many', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const tokens = new SomeTokens(1_001);

    expect(await new AccessTokenCleanup(tokens, { now: () => NOW }).run()).toBe(
      1_001,
    );

    expect(tokens.asked).toEqual([
      [NOW, 1_000],
      [NOW, 1_000],
    ]);
    expect(log).toHaveBeenCalledWith('Deleted 1001 spent order access tokens');
  });
});
