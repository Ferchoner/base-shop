import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { GuestCartCleanup, InactiveGuestCarts } from './guest-cart-cleanup.js';

const NOW = new Date('2026-10-31T09:00:00.000Z');

class SomeCarts extends InactiveGuestCarts {
  readonly asked: [Date, number][] = [];

  constructor(private left: number) {
    super();
  }

  delete(before: Date, limit: number): Promise<number> {
    this.asked.push([before, limit]);
    const deleted = Math.min(limit, this.left);
    this.left -= deleted;
    return Promise.resolve(deleted);
  }
}

describe('GuestCartCleanup (UC-CRT-07, BR-CRT-06, ADR-0144)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes the guest carts without activity for 30 days, in batches, and logs how many', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const carts = new SomeCarts(1_001);

    expect(await new GuestCartCleanup(carts, { now: () => NOW }).run()).toBe(
      1_001,
    );

    expect(carts.asked).toEqual([
      [new Date('2026-10-01T09:00:00.000Z'), 1_000],
      [new Date('2026-10-01T09:00:00.000Z'), 1_000],
    ]);
    expect(log).toHaveBeenCalledWith('Deleted 1001 inactive guest carts');
  });
});
