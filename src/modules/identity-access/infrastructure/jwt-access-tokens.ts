import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parseDuration } from '../../../platform/config/duration.js';
import type { EnvironmentVariables } from '../../../platform/config/environment.js';
import {
  type AccessToken,
  AccessTokens,
} from '../application/session-tokens.js';
import type { SessionId } from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import { AccessTokenKey } from './access-token-key.js';

/** Algorithm of the access tokens; verification accepts only this one (ADR-0114). */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';

/**
 * Access tokens as JWT signed with HS256 (ADR-0023, ADR-0114). The claims are only `sub` (the user) and
 * `sid` (the session), plus `iat` and `exp`: the account, its permissions and the session are read on each
 * request, so nothing in the token goes stale.
 */
@Injectable()
export class JwtAccessTokens extends AccessTokens {
  private readonly jwt: JwtService;
  private readonly ttlSeconds: number;

  constructor(
    key: AccessTokenKey,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super();
    this.ttlSeconds = parseDuration(
      config.get('ACCESS_TOKEN_TTL', { infer: true }),
    );
    this.jwt = new JwtService({
      secret: key.secret,
      signOptions: {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        expiresIn: this.ttlSeconds,
      },
    });
  }

  issue(userId: UserId, sessionId: SessionId): AccessToken {
    return {
      token: this.jwt.sign({ sub: userId, sid: sessionId }),
      expiresInSeconds: this.ttlSeconds,
    };
  }
}
