import { Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  type DomainEvent,
  DomainEventPublisher,
  eventMetadata,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  CartId,
  CustomerId,
  Order,
  OrderId,
  VariantId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderStock } from './checkout-ports.js';

/** How many orders one run expires at most; the next run, a minute later, goes on (ADR-0029). */
export const EXPIRY_BATCH_SIZE = 100;

/**
 * Published when an unpaid order expires (UC-ORD-10). It carries what Shopping needs to put the lines back in
 * a cart (UC-CRT-08, ADR-0054), because Shopping never reads Ordering (ADR-0136).
 */
export interface OrderExpired extends DomainEvent<'OrderExpired'> {
  readonly orderId: OrderId;
  /** `null` for a guest order. */
  readonly customerId: CustomerId | null;
  /** `null` for a store order: it has no cart to go back to (ADR-0161). */
  readonly sourceCartId: CartId | null;
  readonly lines: readonly {
    readonly variantId: VariantId;
    readonly quantity: number;
  }[];
}

/** What one run of the expiration did. */
export interface ExpiryRun {
  readonly expired: number;
  readonly failed: number;
}

/**
 * Expires the orders that were not paid in time, with their reservations (UC-ORD-10, UC-INV-08, ADR-0136).
 * The scheduled job calls it every minute.
 */
@Injectable()
export class OrderExpiry {
  private readonly logger = new Logger(OrderExpiry.name);

  constructor(
    private readonly orders: OrderRepository,
    private readonly stock: OrderStock,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Expires up to `EXPIRY_BATCH_SIZE` orders whose payment is due, each in its own transaction, so one that
   * fails is logged and the rest go on (ADR-0029). Expiring an order again changes nothing.
   */
  async expireDue(): Promise<ExpiryRun> {
    const due = await this.orders.dueForExpiry(
      this.clock.now(),
      EXPIRY_BATCH_SIZE,
    );
    let expired = 0;
    let failed = 0;
    for (const id of due) {
      try {
        if (await this.expire(id)) expired += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Order ${id} could not expire`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return { expired, failed };
  }

  /**
   * Expires the order and its reservation together, with the order locked: a payment or a cancellation that
   * arrives at the same time waits, and then finds it EXPIRED (ADR-0012), or the order was paid or cancelled
   * first and nothing changes.
   */
  private expire(id: OrderId): Promise<boolean> {
    return this.transactions.run(async () => {
      const order = await this.orders.lock(id);
      const now = this.clock.now();
      if (order === null || !order.expireIfDue(now)) return false;
      await this.stock.expire(order.id);
      await this.orders.save(order, now);
      this.events.publish(expiredEvent(order, now));
      return true;
    });
  }
}

function expiredEvent(order: Order, now: Date): OrderExpired {
  const { id, customerId, sourceCartId, lines } = order.snapshot;
  return {
    ...eventMetadata('OrderExpired', now),
    orderId: id,
    customerId,
    sourceCartId,
    lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
  };
}
