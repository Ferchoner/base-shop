import type { RefreshTokenRecord, SessionId } from './session.js';
import type { UserId } from './user.js';

export type NewRefreshToken = Omit<
  RefreshTokenRecord,
  'revokedAt' | 'replacedById'
>;

/**
 * Sessions as their refresh tokens (`refresh_tokens`, DATABASE.md §3.6, ADR-0023). A session is active while
 * one of its tokens is usable. An abstract class rather than an interface, so it can be the dependency
 * injection token without depending on NestJS.
 */
export abstract class SessionRepository {
  abstract add(token: NewRefreshToken): Promise<void>;

  /** The token with this hash, without locking it. */
  abstract findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;

  /**
   * The token with this hash, its row locked until the transaction ends, so two renewals with the same token
   * run one after the other and the second one sees it rotated.
   */
  abstract findByHashForUpdate(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null>;

  /** Stores `next` and marks `token` as rotated into it, which also makes it unusable. */
  abstract rotate(
    token: RefreshTokenRecord,
    next: NewRefreshToken,
    at: Date,
  ): Promise<void>;

  /** Revokes the session's tokens that are still usable. Returns how many were. */
  abstract revokeSession(sessionId: SessionId, at: Date): Promise<number>;

  /** Revokes every session of the user (suspension, ADR-0023). */
  abstract revokeAllOf(userId: UserId, at: Date): Promise<void>;

  /** Whether the user's session still has a usable token, so its access tokens are honored (ADR-0114). */
  abstract isActive(
    sessionId: SessionId,
    userId: UserId,
    now: Date,
  ): Promise<boolean>;
}
