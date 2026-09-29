/**
 * A link sent by email that works once (email verification and password recovery, ADR-0046, ADR-0056): its
 * token is stored only as a hash, and a newer link replaces it.
 */
export interface OneTimeLink {
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  /** Set when a newer link, or a change of email, replaced it. */
  readonly invalidatedAt: Date | null;
}

/** A link works once, within its lifetime, and only until a newer one replaces it (BR-USR-11, BR-USR-16). */
export function isUsableLink(link: OneTimeLink, now: Date): boolean {
  return (
    link.usedAt === null &&
    link.invalidatedAt === null &&
    link.expiresAt.getTime() > now.getTime()
  );
}
