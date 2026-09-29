import type { Id } from '../../../shared-kernel/index.js';
import type { UserId } from './user.js';

export type EmailVerificationTokenId = Id<'EmailVerificationToken'>;

/** A verification link as stored: only its SHA-256 hash, never the token (DATABASE.md §3.6, ADR-0046). */
export interface EmailVerificationToken {
  readonly id: EmailVerificationTokenId;
  readonly userId: UserId;
  /** The address the link was sent to; it verifies only that one. */
  readonly email: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  /** Set when a newer link replaced it. */
  readonly invalidatedAt: Date | null;
}

/** A link verifies once, within its lifetime, and only until a newer one replaces it (BR-USR-11). */
export function isUsableVerification(
  token: EmailVerificationToken,
  now: Date,
): boolean {
  return (
    token.usedAt === null &&
    token.invalidatedAt === null &&
    token.expiresAt.getTime() > now.getTime()
  );
}

/**
 * Stored verification links (`email_verification_tokens`). An abstract class rather than an interface, so
 * it can be the dependency injection token without depending on NestJS.
 */
export abstract class EmailVerificationTokenRepository {
  abstract add(
    token: Omit<EmailVerificationToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void>;

  /** The link with this hash, its row locked until the transaction ends, so it verifies only once. */
  abstract findByHashForUpdate(
    tokenHash: string,
  ): Promise<EmailVerificationToken | null>;

  abstract markUsed(id: EmailVerificationTokenId, at: Date): Promise<void>;

  /** Invalidates the user's links not yet used: a new link, or a new email, replaces them (BR-USR-11). */
  abstract invalidatePendingOf(userId: UserId, at: Date): Promise<void>;
}
