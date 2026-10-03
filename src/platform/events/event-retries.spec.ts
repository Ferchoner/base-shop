import {
  DELIVERY_BATCH_SIZE,
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  nextAttemptAt,
} from './event-retries.js';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const minutesLater = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000);

describe('retries of event deliveries (ADR-0150)', () => {
  it('waits 1, 5 and 15 minutes, then 1, 3, 6 and 12 hours, and gives up after the 8th attempt', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8].map((attempts) => nextAttemptAt(attempts, NOW)),
    ).toEqual([
      minutesLater(1),
      minutesLater(5),
      minutesLater(15),
      minutesLater(60),
      minutesLater(180),
      minutesLater(360),
      minutesLater(720),
      null,
    ]);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(8);
  });

  it('gives a new delivery a minute, as if its first attempt failed, so the retry job leaves it to the dispatch after the commit', () => {
    expect(nextAttemptAt(0, NOW)).toEqual(minutesLater(1));
  });

  it('holds a delivery 5 minutes, and takes 100 per run', () => {
    expect([DELIVERY_LEASE_MS, DELIVERY_BATCH_SIZE]).toEqual([300_000, 100]);
  });
});
