import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { ProcessedWebhookEvents } from '../application/webhook-event-cleanup.js';

/** `processed_webhook_events` (DATABASE.md §9.4), deleted in batches outside any transaction (ADR-0144). */
@Injectable()
export class PrismaProcessedWebhookEvents extends ProcessedWebhookEvents {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  delete(before: Date, limit: number): Promise<number> {
    return this.txHost.tx.$executeRaw`
      DELETE FROM processed_webhook_events
       WHERE (provider, event_id) IN (
             SELECT provider, event_id FROM processed_webhook_events
              WHERE processed_at < ${before}
              LIMIT ${limit})`;
  }
}
