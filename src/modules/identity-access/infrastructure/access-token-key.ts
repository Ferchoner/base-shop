import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../platform/config/environment.js';

/**
 * The key that signs and verifies access tokens (ADR-0023, ADR-0114). One instance per process, so signing
 * and verifying always agree.
 */
export class AccessTokenKey {
  private constructor(readonly secret: string) {}

  /**
   * `JWT_SECRET`, required in production by the configuration validation. Without it, development and test
   * use a random key for this process: every session ends when the API restarts.
   */
  static fromConfig(
    config: ConfigService<EnvironmentVariables, true>,
  ): AccessTokenKey {
    const secret = config.get('JWT_SECRET', { infer: true });
    if (secret !== undefined) return new AccessTokenKey(secret);
    if (config.get('NODE_ENV', { infer: true }) === 'development') {
      new Logger('Authentication').warn(
        'JWT_SECRET is not set: access tokens are signed with a random key, so sessions end when the API restarts',
      );
    }
    return new AccessTokenKey(randomBytes(32).toString('base64url'));
  }
}
