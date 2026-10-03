import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  AuditTrail,
  Clock,
  type DomainEvent,
  InvalidStateTransitionError,
  NotFoundError,
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
  TransactionManager,
} from '../../shared-kernel/index.js';
import type { Prisma } from '../persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../persistence/transactional-plugin.js';
import { fromPayload } from './event-payload.js';

export const DELIVERY_STATUSES = ['PENDING', 'DELIVERED', 'FAILED'] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** A delivery as the staff sees it (ADR-0150): its event, with the content, never personal data. */
export interface EventDeliveryView {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly handler: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly lastError: string | null;
  readonly deliveredAt: Date | null;
  /** The event, with its dates as dates. */
  readonly event: DomainEvent;
}

/** Which deliveries a listing or a retry covers. */
export interface DeliveryFilter {
  /** Any of these. */
  readonly status?: readonly DeliveryStatus[];
  readonly eventType?: string;
  readonly handler?: string;
}

export type DeliverySortField = 'occurredAt' | 'nextAttemptAt';

const DELIVERY_FIELDS = {
  id: true,
  handler: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastError: true,
  deliveredAt: true,
  event: {
    select: { id: true, eventType: true, occurredAt: true, payload: true },
  },
} satisfies Prisma.EventDeliverySelect;

/**
 * The deliveries of domain events for the staff (T-109 part b, ADR-0150), with `events.manage`: listing them, and
 * retrying the ones that failed. A retried delivery goes back to PENDING with its 8 attempts, due right away, so the
 * retry job takes it within a minute. Retries are audited.
 */
@Injectable()
export class EventDeliveries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** The deliveries that match, ordered as asked; ties are broken by ID. */
  async list(
    filter: DeliveryFilter,
    sort: readonly SortOrder<DeliverySortField>[],
    page: PageRequest,
  ): Promise<Page<EventDeliveryView>> {
    const where = whereOf(filter);
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.eventDelivery.findMany({
        select: DELIVERY_FIELDS,
        where,
        orderBy: [
          ...sort.map(({ field, direction }) =>
            field === 'occurredAt'
              ? { event: { occurredAt: direction } }
              : { nextAttemptAt: direction },
          ),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.eventDelivery.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        eventId: row.event.id,
        eventType: row.event.eventType,
        occurredAt: row.event.occurredAt,
        handler: row.handler,
        status: row.status,
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt,
        lastError: row.lastError,
        deliveredAt: row.deliveredAt,
        event: fromPayload(row.event.payload),
      })),
      totalItems,
    };
  }

  /**
   * Retries a failed delivery: back to PENDING, with no attempts and due now. Audited as
   * `events.retry-delivery`.
   *
   * @throws NotFoundError when there is no such delivery; InvalidStateTransitionError when it did not fail.
   */
  retry(id: string): Promise<void> {
    return this.transactions.run(async () => {
      const retried = await this.txHost.tx.eventDelivery.updateMany({
        where: { id, status: 'FAILED' },
        data: this.pendingAgain(),
      });
      if (retried.count === 0) {
        const delivery = await this.txHost.tx.eventDelivery.findUnique({
          select: { status: true },
          where: { id },
        });
        if (delivery === null) throw new NotFoundError('Event delivery', id);
        throw new InvalidStateTransitionError(delivery.status, 'retry');
      }
      await this.audit.record({
        action: 'events.retry-delivery',
        resource: { type: 'event-delivery', id },
        changes: { status: { from: 'FAILED', to: 'PENDING' } },
      });
    });
  }

  /**
   * Retries every failed delivery of the event type or the handler given, or of all of them, as `retry` does: after
   * fixing what made many fail. Audited once, as `events.retry-deliveries`, with the filter and how many it retried;
   * nothing is audited when none matched.
   *
   * @returns how many deliveries it retried.
   */
  retryAll(filter: {
    readonly eventType?: string;
    readonly handler?: string;
  }): Promise<number> {
    return this.transactions.run(async () => {
      const { count } = await this.txHost.tx.eventDelivery.updateMany({
        where: whereOf({ ...filter, status: ['FAILED'] }),
        data: this.pendingAgain(),
      });
      if (count > 0) {
        await this.audit.record({
          action: 'events.retry-deliveries',
          changes: {
            status: { from: 'FAILED', to: 'PENDING' },
            retried: { from: 0, to: count },
            ...(filter.eventType === undefined
              ? {}
              : { eventType: { from: null, to: filter.eventType } }),
            ...(filter.handler === undefined
              ? {}
              : { handler: { from: null, to: filter.handler } }),
          },
        });
      }
      return count;
    });
  }

  private pendingAgain(): Prisma.EventDeliveryUpdateManyMutationInput {
    return {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: this.clock.now(),
      lockedUntil: null,
    };
  }
}

function whereOf(filter: DeliveryFilter): Prisma.EventDeliveryWhereInput {
  return {
    ...(filter.status === undefined
      ? {}
      : { status: { in: [...filter.status] } }),
    ...(filter.handler === undefined ? {} : { handler: filter.handler }),
    ...(filter.eventType === undefined
      ? {}
      : { event: { eventType: filter.eventType } }),
  };
}
