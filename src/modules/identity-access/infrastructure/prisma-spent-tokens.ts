import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { SpentTokens } from '../application/token-cleanup.js';

/**
 * `refresh_tokens`, `email_verification_tokens` and `password_reset_tokens` that no longer work (DATABASE.md §3.6),
 * deleted in batches outside any transaction: each statement is its own (ADR-0144). The `DELETE` checks again
 * what the batch was chosen by, so a row that changed meanwhile stays.
 */
@Injectable()
export class PrismaSpentTokens extends SpentTokens {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  deleteRefreshTokens(before: Date, limit: number): Promise<number> {
    return this.txHost.tx.$executeRaw`
      DELETE FROM refresh_tokens
       WHERE id IN (
             SELECT id FROM refresh_tokens
              WHERE expires_at < ${before} OR revoked_at < ${before}
              LIMIT ${limit})
         AND (expires_at < ${before} OR revoked_at < ${before})`;
  }

  deleteEmailVerificationTokens(now: Date, limit: number): Promise<number> {
    return this.txHost.tx.$executeRaw`
      DELETE FROM email_verification_tokens
       WHERE id IN (
             SELECT id FROM email_verification_tokens
              WHERE expires_at <= ${now} OR used_at IS NOT NULL OR invalidated_at IS NOT NULL
              LIMIT ${limit})
         AND (expires_at <= ${now} OR used_at IS NOT NULL OR invalidated_at IS NOT NULL)`;
  }

  deletePasswordResetTokens(now: Date, limit: number): Promise<number> {
    return this.txHost.tx.$executeRaw`
      DELETE FROM password_reset_tokens
       WHERE id IN (
             SELECT id FROM password_reset_tokens
              WHERE expires_at <= ${now} OR used_at IS NOT NULL OR invalidated_at IS NOT NULL
              LIMIT ${limit})
         AND (expires_at <= ${now} OR used_at IS NOT NULL OR invalidated_at IS NOT NULL)`;
  }
}
