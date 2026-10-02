/** Rows one statement of a cleanup deletes at most (ADR-0144). */
export const CLEANUP_BATCH_SIZE = 1_000;

/** Statements one run of a cleanup makes at most; what is left waits for the next day (ADR-0144). */
export const CLEANUP_MAX_BATCHES = 100;

/**
 * Deletes in batches (ADR-0029, ADR-0144): each call of `deleteBatch` removes at most `batchSize` rows in its
 * own statement, so a failure loses only its batch, and the loop ends when a batch comes back short or after
 * `maxBatches`. Running it again changes nothing, since what it deleted is gone. Answers how many rows it deleted.
 */
export async function deleteInBatches(
  deleteBatch: (limit: number) => Promise<number>,
  limits: { readonly batchSize: number; readonly maxBatches: number } = {
    batchSize: CLEANUP_BATCH_SIZE,
    maxBatches: CLEANUP_MAX_BATCHES,
  },
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    const count = await deleteBatch(limits.batchSize);
    deleted += count;
    if (count < limits.batchSize) break;
  }
  return deleted;
}

/** Days a deleted row waited after it stopped mattering, as a cutoff before `now`. */
export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
