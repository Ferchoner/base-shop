import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  daysBefore,
  deleteInBatches,
} from '../../shared-kernel/index.js';
import { PrismaService } from '../persistence/prisma.service.js';

/** Days a domain event stays after its last delivery (`DELIVERED_EVENT_RETENTION_DAYS`, ADR-0150). */
export const DELIVERED_EVENT_RETENTION_DAYS = Symbol(
  'DELIVERED_EVENT_RETENTION_DAYS',
);

/**
 * The daily cleanup of the outbox (UC-SYS-01, ADR-0144, ADR-0150): the events whose deliveries all succeeded more than
 * DELIVERED_EVENT_RETENTION_DAYS ago, with their deliveries. An event with a delivery pending or failed stays. Each
 * statement deletes a batch on its own, outside any transaction. Unlike other cleanups, the `DELETE` does not check
 * the batch again: the deliveries of such an event never change, since the staff only retries failed ones. A system
 * task: not audited.
 */
@Injectable()
export class DeliveredEventCleanup {
  private readonly logger = new Logger(DeliveredEventCleanup.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(DELIVERED_EVENT_RETENTION_DAYS) private readonly days: number,
  ) {}

  /** Answers how many events it deleted. */
  async run(): Promise<number> {
    const before = daysBefore(this.clock.now(), this.days);
    const deleted = await deleteInBatches(
      (limit) => this.prisma.$executeRaw`
        DELETE FROM domain_events
         WHERE id IN (
               SELECT e.id FROM domain_events AS e
                WHERE NOT EXISTS (
                      SELECT 1 FROM event_deliveries AS d
                       WHERE d.event_id = e.id
                         AND (d.status <> 'DELIVERED' OR d.delivered_at >= ${before}))
                LIMIT ${limit})`,
    );
    this.logger.log(`Deleted ${deleted} delivered domain events`);
    return deleted;
  }
}
