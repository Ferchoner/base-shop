import type { Id } from '../../../shared-kernel/index.js';
import type { UserId } from './user.js';

/** A sign-in: the family of refresh tokens issued from one login, revoked as a whole (ADR-0023). */
export type SessionId = Id<'Session'>;
export type RefreshTokenId = Id<'RefreshToken'>;

/** A refresh token as stored: only its SHA-256 hash, never the token (DATABASE.md §3.6). */
export interface RefreshTokenRecord {
  readonly id: RefreshTokenId;
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  /** When it stopped being usable: rotated, signed out, or its session revoked. */
  readonly revokedAt: Date | null;
  /** The token it was rotated into; set only by a renewal. */
  readonly replacedById: RefreshTokenId | null;
}

/**
 * What presenting a refresh token means (ADR-0023):
 * - `usable`: it renews the session;
 * - `rotated`: it was already renewed, so presenting it again is a reuse and the whole session is revoked;
 * - `revoked`: its session ended (sign-out, suspension, reuse);
 * - `expired`: unused for the whole refresh token lifetime.
 *
 * Rotation is checked first: a rotated token stays a sign of theft even after it expires.
 */
export type RefreshTokenState = 'usable' | 'rotated' | 'revoked' | 'expired';

export function refreshTokenState(
  token: RefreshTokenRecord,
  now: Date,
): RefreshTokenState {
  if (token.replacedById !== null) return 'rotated';
  if (token.revokedAt !== null) return 'revoked';
  if (token.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'usable';
}
