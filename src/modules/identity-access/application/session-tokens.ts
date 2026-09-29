import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { newId } from '../../../shared-kernel/index.js';
import type { SessionId } from '../domain/session.js';
import type { NewRefreshToken } from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';

/** Seconds a refresh token lives (`REFRESH_TOKEN_TTL`, ADR-0023). */
export const REFRESH_TOKEN_TTL_SECONDS = Symbol('REFRESH_TOKEN_TTL_SECONDS');

export interface AccessToken {
  readonly token: string;
  readonly expiresInSeconds: number;
}

/**
 * Signs access tokens (ADR-0023, ADR-0114). They carry only the user and the session; everything else is
 * read on each request.
 */
export abstract class AccessTokens {
  abstract issue(userId: UserId, sessionId: SessionId): AccessToken;
}

/** The token pair handed to the client after signing in or renewing (`AuthResult`, API_SPEC.md §8.11). */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresIn: number;
  readonly refreshToken: string;
  readonly refreshTokenExpiresIn: number;
}

/** Only the hash of a refresh token is stored; a stolen table does not hold usable tokens (ADR-0023). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates the tokens of a session. A refresh token is opaque: `rt_` and 256 random bits in base64url, so a
 * fast hash is enough to store it.
 */
@Injectable()
export class SessionTokens {
  constructor(
    private readonly accessTokens: AccessTokens,
    @Inject(REFRESH_TOKEN_TTL_SECONDS)
    private readonly refreshTokenTtlSeconds: number,
  ) {}

  /** A new refresh token of the session, and the record to store for it. */
  newRefreshToken(
    userId: UserId,
    sessionId: SessionId,
    now: Date,
  ): { readonly token: string; readonly record: NewRefreshToken } {
    const token = `rt_${randomBytes(32).toString('base64url')}`;
    return {
      token,
      record: {
        id: newId(),
        userId,
        sessionId,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(now.getTime() + this.refreshTokenTtlSeconds * 1000),
      },
    };
  }

  /** The pair for the client: a new access token and the refresh token just stored. */
  pair(
    userId: UserId,
    sessionId: SessionId,
    refreshToken: string,
  ): IssuedTokens {
    const access = this.accessTokens.issue(userId, sessionId);
    return {
      accessToken: access.token,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken,
      refreshTokenExpiresIn: this.refreshTokenTtlSeconds,
    };
  }
}
