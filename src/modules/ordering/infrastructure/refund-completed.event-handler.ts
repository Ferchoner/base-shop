import { Injectable, Logger } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { type DomainEvent, toId } from '../../../shared-kernel/index.js';
import { OrderLifecycle } from '../application/order-lifecycle.use-case.js';

/**
 * `RefundCompleted` as Ordering reads it (ADR-0135). Payments publishes it; Ordering declares its own type and
 * subscribes by name, so it never imports Payments' events (ARCHITECTURE.md).
 */
export interface RefundCompleted extends DomainEvent<'RefundCompleted'> {
  readonly refundId: string;
  readonly paymentId: string;
  readonly orderId: string;
}

/**
 * Marks the cancelled order of a completed refund as REFUNDED (ADR-0051), in the background after the refund
 * commits (ADR-0098, API_SPEC.md §2.5). A refund of an order that is not cancelled goes to the log, for the
 * staff to look at.
 */
@Injectable()
export class RefundCompletedHandler {
  private readonly logger = new Logger(RefundCompletedHandler.name);

  constructor(private readonly lifecycle: OrderLifecycle) {}

  @OnDomainEvent('RefundCompleted')
  async onRefundCompleted(event: RefundCompleted): Promise<void> {
    const outcome = await this.lifecycle.recordRefund({
      orderId: toId<'Order'>(event.orderId),
      completedAt: event.occurredAt,
    });
    if (outcome === 'unexpected') {
      this.logger.error(
        `Refund ${event.refundId} of payment ${event.paymentId} completed for order ${event.orderId}, which is not a cancelled one with a payment`,
      );
    }
  }
}
