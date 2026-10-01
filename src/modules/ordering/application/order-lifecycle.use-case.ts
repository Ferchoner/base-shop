import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  InvalidStateTransitionError,
  type Money,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Order, OrderId, StaffId } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { RestockNotAllowedError } from '../domain/ordering-errors.js';
import { OrderStock, type StockLine } from './checkout-ports.js';
import { OrderPayments } from './payment-ports.js';

/** What a captured payment did to its order (UC-ORD-09). */
export type PaymentOutcome =
  /** The order is PAID and its stock left the warehouse. */
  | 'paid'
  /** A late payment found no stock: the staff resolves it (ADR-0012). */
  | 'awaiting-manual-fulfillment'
  /** The order was cancelled first: it keeps the payment and waits for its refund (ADR-0133). */
  | 'recorded-on-cancelled'
  /** A repeated event, or a payment of an order already past payment: nothing changed. */
  | 'already-processed'
  /** The captured amount is not the total of the order: nothing changed (BR-ORD-08). */
  | 'amount-mismatch';

/** What a completed refund did to its order (ADR-0051). */
export type RefundOutcome =
  /** The order is REFUNDED. */
  | 'refunded'
  /** A repeated event: the order was already REFUNDED. */
  | 'already-processed'
  /** The order is not a cancelled one with a payment: nothing changed. */
  | 'unexpected';

/**
 * The life of an order after it is placed (UC-ORD-07 to 09, ADR-0133): the staff cancels it or retries its
 * fulfillment, and a captured payment marks it paid. Each change locks the order, so a staff action and a
 * payment that arrive together wait for each other.
 */
@Injectable()
export class OrderLifecycle {
  constructor(
    private readonly orders: OrderRepository,
    private readonly stock: OrderStock,
    private readonly payments: OrderPayments,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * Cancels an order that was not shipped (UC-ORD-07, ADR-0051): an unpaid one releases its reservation and
   * its pending payment, and a paid one, PAID or waiting for stock, starts its full refund in the same
   * transaction (UC-PAY-03). The restock option comes with T-161 (ADR-0135).
   *
   * @throws NotFoundError; VersionConflictError; RestockNotAllowedError whenever the restock is asked, until
   *   T-161; InvalidStateTransitionError from SHIPPED on, or for an order already cancelled or expired.
   */
  cancel(input: {
    orderId: OrderId;
    actorId: StaffId;
    reason: string;
    restock: boolean;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const order = await this.found(input.orderId);
      assertVersion(order.version, input.version);
      if (input.restock) {
        throw order.status === 'PAID'
          ? RestockNotAllowedError.unavailable()
          : RestockNotAllowedError.notPaid(order.status);
      }
      const before = order.status;
      const now = this.clock.now();
      order.cancel(input.actorId, input.reason, now);
      if (before === 'PENDING_PAYMENT') {
        await this.stock.release(order.id);
        await this.payments.cancelPending(order.id);
      } else {
        // Paid: the full refund starts in the same operation (UC-PAY-03, ADR-0051).
        await this.payments.startRefund(order.id);
      }
      await this.orders.save(order, now);
      await this.audit.record({
        action: 'orders.cancel',
        resource: { type: 'order', id: order.id },
        changes: changesBetween({ status: before }, { status: order.status }),
        reason: input.reason,
      });
    });
  }

  /**
   * Reserves and confirms again the stock of an order that waited for it, which becomes PAID (UC-ORD-08,
   * ADR-0012). Without stock nothing changes, and the staff can cancel it instead.
   *
   * @throws NotFoundError; VersionConflictError; InvalidStateTransitionError unless the order is
   *   AWAITING_MANUAL_FULFILLMENT; InsufficientStockError.
   */
  retryFulfillment(input: {
    orderId: OrderId;
    actorId: StaffId;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const order = await this.found(input.orderId);
      assertVersion(order.version, input.version);
      // Checked before reserving, so another status never answers about the stock.
      if (order.status !== 'AWAITING_MANUAL_FULFILLMENT') {
        throw new InvalidStateTransitionError(
          order.status,
          'retry fulfillment',
        );
      }
      const reservation = await this.stock.reserve(order.id, linesOf(order));
      await this.stock.commit(order.id);
      const before = order.status;
      const now = this.clock.now();
      order.fulfillManually(input.actorId, reservation.id, now);
      await this.orders.save(order, now);
      await this.audit.record({
        action: 'orders.retry-fulfillment',
        resource: { type: 'order', id: order.id },
        changes: changesBetween({ status: before }, { status: order.status }),
      });
    });
  }

  /**
   * Applies a captured payment to its order (UC-ORD-09, BR-ORD-08 and 09, ADR-0012). Repeating it changes
   * nothing, so a duplicated event is harmless.
   *
   * @throws NotFoundError for an order that does not exist.
   */
  recordPayment(payment: {
    orderId: OrderId;
    amount: Money;
    capturedAt: Date;
  }): Promise<PaymentOutcome> {
    return this.transactions.run(async () => {
      const order = await this.found(payment.orderId);
      if (!payment.amount.equals(order.grandTotal)) return 'amount-mismatch';
      const now = this.clock.now();
      let outcome: PaymentOutcome;
      switch (order.status) {
        case 'PENDING_PAYMENT':
          if ((await this.stock.commit(order.id)) === 'not-active') {
            outcome = await this.latePayment(order, payment.capturedAt, now);
          } else {
            order.markPaid(payment.capturedAt, now);
            outcome = 'paid';
          }
          break;
        case 'EXPIRED':
          outcome = await this.latePayment(order, payment.capturedAt, now);
          break;
        case 'CANCELLED':
          if (!order.recordPaymentAfterCancellation(payment.capturedAt)) {
            return 'already-processed';
          }
          // So the staff can register its refund like any other (ADR-0135).
          await this.payments.startRefund(order.id);
          outcome = 'recorded-on-cancelled';
          break;
        default:
          return 'already-processed';
      }
      await this.orders.save(order, now);
      return outcome;
    });
  }

  /**
   * Marks a cancelled order refunded when its refund completes (ADR-0051, ADR-0135). Repeating it changes
   * nothing, so a duplicated event is harmless.
   *
   * @throws NotFoundError for an order that does not exist.
   */
  recordRefund(refund: {
    orderId: OrderId;
    completedAt: Date;
  }): Promise<RefundOutcome> {
    return this.transactions.run(async () => {
      const order = await this.found(refund.orderId);
      if (order.status === 'REFUNDED') return 'already-processed';
      if (order.status !== 'CANCELLED' || order.snapshot.paidAt === null) {
        return 'unexpected';
      }
      const now = this.clock.now();
      order.markRefunded(refund.completedAt, now);
      await this.orders.save(order, now);
      return 'refunded';
    });
  }

  /** A payment whose reservation ended: reserve again, or wait for the staff (BR-ORD-09, ADR-0012). */
  private async latePayment(
    order: Order,
    capturedAt: Date,
    now: Date,
  ): Promise<PaymentOutcome> {
    const reservation = await this.stock.reserveIfAvailable(
      order.id,
      linesOf(order),
    );
    if (reservation === null) {
      order.awaitManualFulfillment(capturedAt, now);
      return 'awaiting-manual-fulfillment';
    }
    await this.stock.commit(order.id);
    order.markPaid(capturedAt, now, reservation.id);
    return 'paid';
  }

  /** The order, locked until the transaction ends. @throws NotFoundError */
  private async found(id: OrderId): Promise<Order> {
    const order = await this.orders.lock(id);
    if (order === null) throw new NotFoundError('Order', id);
    return order;
  }
}

function linesOf(order: Order): StockLine[] {
  return order.snapshot.lines.map(({ variantId, quantity }) => ({
    variantId,
    quantity,
  }));
}
