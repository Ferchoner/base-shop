import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../../platform/auth/authenticated-user.js';
import { toId } from '../../../shared-kernel/index.js';
import { ResolveSignedInAccount } from '../application/resolve-signed-in-account.js';
import type { SessionId } from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import { AccessTokenKey } from './access-token-key.js';
import { ACCESS_TOKEN_ALGORITHM } from './jwt-access-tokens.js';

/**
 * Passport strategy for the access token in `Authorization: Bearer` (ADR-0022, ADR-0023). Passport checks
 * the signature, the algorithm and the expiry; the account behind it is read on every request (ADR-0114).
 * It returns the user for `request.user`, or `false` when the token no longer grants access.
 */
@Injectable()
// Registered as 'jwt', the name AccessTokenGuard uses.
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    key: AccessTokenKey,
    private readonly accounts: ResolveSignedInAccount,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: key.secret,
      algorithms: [ACCESS_TOKEN_ALGORITHM],
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser | false> {
    const claims = claimsOf(payload);
    if (claims === undefined) return false;
    return (
      (await this.accounts.execute(claims.userId, claims.sessionId)) ?? false
    );
  }
}

/** The user and session of the claims; any other token signed with the key is not an access token. */
function claimsOf(
  payload: unknown,
): { userId: UserId; sessionId: SessionId } | undefined {
  const { sub, sid } = (payload ?? {}) as { sub?: unknown; sid?: unknown };
  if (typeof sub !== 'string' || typeof sid !== 'string') return undefined;
  try {
    return { userId: toId(sub), sessionId: toId(sid) };
  } catch {
    return undefined;
  }
}
