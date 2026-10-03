import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { SpentAccessTokens } from '../application/access-token-cleanup.js';

/**
 * `order_access_tokens` that no longer work (DATABASE.md §8.4), deleted in batches outside any transaction: each
 * statement is its own (ADR-0144). The `DELETE` checks again what the batch was chosen by, so a row that changed
 * meanwhile stays.
 */
@Injectable()
export class PrismaSpentAccessTokens extends SpentAccessTokens {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  delete(now: Date, limit: number): Promise<number> {
    return this.txHost.tx.$executeRaw`
      DELETE FROM order_access_tokens
       WHERE id IN (
             SELECT id FROM order_access_tokens
              WHERE expires_at <= ${now} OR used_at IS NOT NULL OR invalidated_at IS NOT NULL
              LIMIT ${limit})
         AND (expires_at <= ${now} OR used_at IS NOT NULL OR invalidated_at IS NOT NULL)`;
  }
}
