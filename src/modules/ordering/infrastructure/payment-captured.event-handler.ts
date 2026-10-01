import { Injectable, Logger } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import {
  type Currency,
  type DomainEvent,
  Money,
  toId,
} from '../../../shared-kernel/index.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';

/**
 * `PaymentCaptured` as Ordering reads it (ADR-0133). Payments publishes it from T-190 on; Ordering declares its
 * own type and subscribes by name, so it never imports Payments (ARCHITECTURE.md).
 */
export interface PaymentCaptured extends DomainEvent<'PaymentCaptured'> {
  readonly paymentId: string;
  readonly orderId: string;
  /** The captured amount; it must be the total of the order (BR-ORD-08). */
  readonly amount: { readonly amount: number; readonly currency: Currency };
}

/**
 * Marks the order of a captured payment as paid (UC-ORD-09), in the background after the payment commits
 * (ADR-0098, API_SPEC.md §2.5). What the staff must look at goes to the log: a payment that does not match
 * the total, and a payment of a cancelled order, which waits for its refund.
 */
@Injectable()
export class PaymentCapturedHandler {
  private readonly logger = new Logger(PaymentCapturedHandler.name);

  constructor(private readonly lifecycle: OrderLifecycle) {}

  @OnDomainEvent('PaymentCaptured')
  async onPaymentCaptured(event: PaymentCaptured): Promise<void> {
    const outcome = await this.lifecycle.recordPayment({
      orderId: toId<'Order'>(event.orderId),
      amount: Money.of(event.amount.amount, event.amount.currency),
      capturedAt: event.occurredAt,
    });
    if (outcome === 'amount-mismatch') {
      this.logger.error(
        `Payment ${event.paymentId} does not match the total of order ${event.orderId}; the order was not marked paid (BR-ORD-08)`,
      );
    } else if (outcome === 'recorded-on-cancelled') {
      this.logger.warn(
        `Payment ${event.paymentId} was captured for cancelled order ${event.orderId}, which now waits for its refund`,
      );
    }
  }
}
