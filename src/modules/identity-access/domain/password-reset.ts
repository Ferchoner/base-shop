import type { Id, OneTimeLink } from '../../../shared-kernel/index.js';
import type { UserId } from './user.js';

export type PasswordResetTokenId = Id<'PasswordResetToken'>;

/** A recovery link as stored: only its SHA-256 hash, never the token (DATABASE.md §3.6, ADR-0056). */
export interface PasswordResetToken extends OneTimeLink {
  readonly id: PasswordResetTokenId;
  readonly userId: UserId;
  readonly tokenHash: string;
}

/**
 * Stored recovery links (`password_reset_tokens`). An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class PasswordResetTokenRepository {
  abstract add(
    token: Omit<PasswordResetToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void>;

  /** The link with this hash, its row locked until the transaction ends, so it resets only once. */
  abstract findByHashForUpdate(
    tokenHash: string,
  ): Promise<PasswordResetToken | null>;

  abstract markUsed(id: PasswordResetTokenId, at: Date): Promise<void>;

  /**
   * Invalidates the user's links not yet used: a new link replaces them, and so does a new email, since they
   * were sent to the previous address (BR-USR-16, ADR-0118).
   */
  abstract invalidatePendingOf(userId: UserId, at: Date): Promise<void>;
}
