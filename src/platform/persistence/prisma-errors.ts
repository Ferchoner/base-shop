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

/** A foreign key rejected the change (Prisma P2003), for example deleting a role that has users. */
export function isForeignKeyViolation(error: unknown): boolean {
  return prismaCode(error) === 'P2003';
}
