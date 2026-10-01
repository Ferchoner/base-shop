/**
 * Database errors that repositories turn into domain errors (ADR-0112). Checked by the Prisma error code,
 * not with `instanceof`, so they work whatever realm created the error.
 */
function prismaCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

/** A `UNIQUE` constraint rejected the row (Prisma P2002), for example a repeated role name. */
export function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2002';
}

/**
 * The name of the unique index that rejected the row, for tables with more than one, such as
 * `categories_slug_key`. The PostgreSQL adapter reports it in `meta.driverAdapterError.cause.constraint`;
 * `undefined` when the error is another one or does not say.
 */
export function uniqueViolationIndex(error: unknown): string | undefined {
  if (!isUniqueViolation(error)) return undefined;
  const index = (
    error as {
      meta?: {
        driverAdapterError?: { cause?: { constraint?: { index?: unknown } } };
      };
    }
  ).meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === 'string' ? index : undefined;
}

/** A foreign key rejected the change (Prisma P2003), for example deleting a role that has users. */
export function isForeignKeyViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2003';
}

/**
 * An exclusion constraint rejected the row (PostgreSQL 23P01), such as two overlapping price periods
 * (BR-PRC-01). Prisma has no code of its own for it: the PostgreSQL adapter reports it in
 * `meta.driverAdapterError.cause.originalCode`.
 */
export function isExclusionViolation(error: unknown): boolean {
  const cause = (
    error as
      | {
          meta?: {
            driverAdapterError?: { cause?: { originalCode?: unknown } };
          };
        }
      | null
      | undefined
  )?.meta?.driverAdapterError?.cause;
  return cause?.originalCode === '23P01';
}
