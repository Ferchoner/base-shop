import { Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  daysBefore,
  deleteInBatches,
} from '../../../shared-kernel/index.js';

/** Days a refresh token is kept after it expired or was revoked (ADR-0029). */
export const SPENT_REFRESH_TOKEN_DAYS = 30;

/**
 * The stored tokens that no longer work, deleted in batches (ADR-0029, ADR-0144). Each call deletes at most
 * `limit` rows in one statement and answers how many it deleted. An abstract class rather than an interface, so
 * it can be the dependency injection token without depending on NestJS.
 */
export abstract class SpentTokens {
  /** Refresh tokens that expired or were revoked before `before`. */
  abstract deleteRefreshTokens(before: Date, limit: number): Promise<number>;

  /** Email verification links expired by `now`, used or replaced (ADR-0056). */
  abstract deleteEmailVerificationTokens(
    now: Date,
    limit: number,
  ): Promise<number>;

  /** Password recovery links expired by `now`, used or replaced (ADR-0056). */
  abstract deletePasswordResetTokens(now: Date, limit: number): Promise<number>;
}

/** What one run deleted of each kind; `null` for a kind that failed, which the log tells. */
export interface TokenCleanupReport {
  readonly refreshTokens: number | null;
  readonly emailVerificationTokens: number | null;
  readonly passwordResetTokens: number | null;
}

/**
 * The daily cleanup of Identity & Access (UC-SYS-01, ADR-0029, ADR-0144): refresh tokens 30 days after they
 * expired or were revoked, and the email verification and password recovery links that no longer work. A kind
 * that fails goes to the log and the others go on. A system task: not audited.
 */
@Injectable()
export class TokenCleanup {
  private readonly logger = new Logger(TokenCleanup.name);

  constructor(
    private readonly tokens: SpentTokens,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<TokenCleanupReport> {
    const now = this.clock.now();
    const before = daysBefore(now, SPENT_REFRESH_TOKEN_DAYS);
    const report = {
      refreshTokens: await this.delete('refresh tokens', (limit) =>
        this.tokens.deleteRefreshTokens(before, limit),
      ),
      emailVerificationTokens: await this.delete(
        'email verification tokens',
        (limit) => this.tokens.deleteEmailVerificationTokens(now, limit),
      ),
      passwordResetTokens: await this.delete('password reset tokens', (limit) =>
        this.tokens.deletePasswordResetTokens(now, limit),
      ),
    };
    this.logger.log(
      `Deleted ${report.refreshTokens ?? 0} refresh tokens, ${report.emailVerificationTokens ?? 0} email verification tokens and ${report.passwordResetTokens ?? 0} password reset tokens`,
    );
    return report;
  }

  private async delete(
    kind: string,
    deleteBatch: (limit: number) => Promise<number>,
  ): Promise<number | null> {
    try {
      return await deleteInBatches(deleteBatch);
    } catch (error) {
      this.logger.error(
        `The cleanup of ${kind} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
