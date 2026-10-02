import {
  CLEANUP_BATCH_SIZE,
  CLEANUP_MAX_BATCHES,
  daysBefore,
  deleteInBatches,
} from './cleanup.js';

/** A table of `rows` rows: each batch deletes what is left, up to its limit. */
function table(rows: number) {
  const limits: number[] = [];
  let left = rows;
  const deleteBatch = (limit: number) => {
    limits.push(limit);
    const deleted = Math.min(limit, left);
    left -= deleted;
    return Promise.resolve(deleted);
  };
  return { deleteBatch, limits, left: () => left };
}

describe('deleteInBatches (ADR-0029, ADR-0144)', () => {
  it('deletes batch after batch of 1,000 until one comes back short', async () => {
    const rows = table(2_500);

    expect(await deleteInBatches(rows.deleteBatch)).toBe(2_500);

    expect(rows.limits).toEqual([1_000, 1_000, 1_000]);
    expect([CLEANUP_BATCH_SIZE, CLEANUP_MAX_BATCHES]).toEqual([1_000, 100]);
  });

  it('stops after a full last batch with nothing left, asking once more', async () => {
    const rows = table(4);

    expect(
      await deleteInBatches(rows.deleteBatch, { batchSize: 2, maxBatches: 5 }),
    ).toBe(4);

    expect(rows.limits).toEqual([2, 2, 2]);
  });

  it('leaves for the next run what passes the batches of one run', async () => {
    const rows = table(10);

    expect(
      await deleteInBatches(rows.deleteBatch, { batchSize: 2, maxBatches: 3 }),
    ).toBe(6);

    expect(rows.left()).toBe(4);
  });

  it('deletes nothing from an empty table, asking once', async () => {
    const rows = table(0);

    expect(await deleteInBatches(rows.deleteBatch)).toBe(0);

    expect(rows.limits).toEqual([1_000]);
  });

  it('counts whole days back', () => {
    expect(daysBefore(new Date('2026-10-31T09:00:00.000Z'), 30)).toEqual(
      new Date('2026-10-01T09:00:00.000Z'),
    );
  });
});
