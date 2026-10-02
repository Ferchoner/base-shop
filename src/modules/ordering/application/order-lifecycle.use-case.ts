import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  DomainEventPublisher,
  InvalidStateTransitionError,
  type Money,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Order, OrderId, StaffId } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { RestockNotAllowedError } from '../domain/ordering-errors.js';
import { OrderStock, type StockLine } from './checkout-ports.js';
import { orderCancelled, orderPaid } from './order-events.js';
import { restockAudit } from './order-restocks.use-case.js';
import { OrderPayments } from './payment-ports.js';
import { OrderShipments } from './shipment-ports.js';

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

/** What the progress of its shipment did to an order (ADR-0141). */
export type ShipmentOutcome =
  /** The order moved: SHIPPED when its shipment left, DELIVERED when it was delivered. */
  | 'moved'
  /** A repeated or late event: the order was already there, or further. */
  | 'already-processed'
  /** The order is not one whose shipment could do that: nothing changed. */
  | 'unexpected';

/**
 * The life of an order after it is placed (UC-ORD-07 to 09, ADR-0133): the staff cancels it or retries its
 * fulfillment, a captured payment marks it paid, and its shipment marks it shipped and delivered (ADR-0141). Each
 * change locks the order, so a staff action and an event that arrive together wait for each other.
 */
@Injectable()
export class OrderLifecycle {
  constructor(
    private readonly orders: OrderRepository,
    private readonly stock: OrderStock,
    private readonly payments: OrderPayments,
    private readonly shipments: OrderShipments,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Cancels an order that was not shipped (UC-ORD-07, ADR-0051): an unpaid one releases its reservation and
   * its pending payment, and a paid one, PAID or waiting for stock, starts its full refund in the same
   * transaction (UC-PAY-03). With `restock`, a PAID order brings every line back to the stock in full, in the
   * same transaction too, audited as `orders.restock` (ADR-0052, ADR-0142).
   *
   * @throws NotFoundError; VersionConflictError; RestockNotAllowedError for a restock of an order that is not
   *   PAID; InvalidStateTransitionError from SHIPPED on, or for an order already cancelled or expired.
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
      if (input.restock && order.status !== 'PAID') {
        throw RestockNotAllowedError.notPaid(order.status);
      }
      const before = order.status;
      const now = this.clock.now();
      order.cancel(input.actorId, input.reason, now);
      if (before === 'PENDING_PAYMENT') {
        await this.stock.release(order.id);
        await this.payments.cancelPending(order.id);
      } else {
        // Paid: its shipment must not have left (ADR-0140), and the full refund starts in the same operation
        // (UC-PAY-03, ADR-0051).
        await this.shipments.cancel(order.id);
        await this.payments.startRefund(order.id);
      }
      const restocked = input.restock ? order.linesToRestock() : [];
      if (input.restock) {
        await this.stock.restock({
          orderId: order.id,
          reasonCode: 'ORDER_CANCELLED',
          note: input.reason,
          actorId: input.actorId,
          lines: restocked,
        });
      }
      await this.orders.save(order, now);
      await this.audit.record({
        action: 'orders.cancel',
        resource: { type: 'order', id: order.id },
        changes: changesBetween({ status: before }, { status: order.status }),
        reason: input.reason,
      });
      if (input.restock) {
        await this.audit.record(
          restockAudit(order.id, 'ORDER_CANCELLED', restocked, input.reason),
        );
      }
      this.events.publish(
        orderCancelled(order.id, before !== 'PENDING_PAYMENT', now),
      );
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
      await this.shipments.createFor(order);
      await this.orders.save(order, now);
      await this.audit.record({
        action: 'orders.retry-fulfillment',
        resource: { type: 'order', id: order.id },
        changes: changesBetween({ status: before }, { status: order.status }),
      });
      this.events.publish(orderPaid(order.id, now));
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
      // A paid order has its shipment from the start (UC-SHI-03, ADR-0140).
      if (outcome === 'paid') await this.shipments.createFor(order);
      await this.orders.save(order, now);
      if (outcome === 'paid') this.events.publish(orderPaid(order.id, now));
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

  /**
   * Marks a paid order SHIPPED when its shipment leaves (UC-SHI-05, ADR-0141), shipped when it left. Repeating it
   * changes nothing, also once the order was delivered.
   *
   * @throws NotFoundError for an order that does not exist.
   */
  recordShipment(shipment: {
    orderId: OrderId;
    dispatchedAt: Date;
  }): Promise<ShipmentOutcome> {
    return this.transactions.run(async () => {
      const order = await this.found(shipment.orderId);
      if (order.status === 'SHIPPED' || order.status === 'DELIVERED') {
        return 'already-processed';
      }
      if (order.status !== 'PAID') return 'unexpected';
      const now = this.clock.now();
      order.markShipped(shipment.dispatchedAt, now);
      await this.orders.save(order, now);
      return 'moved';
    });
  }

  /**
   * Marks an order DELIVERED when its shipment is delivered (UC-SHI-06, ADR-0141). An order still PAID is marked
   * SHIPPED first, from when the shipment left: the event of its dispatch is late or was lost. Repeating it changes
   * nothing.
   *
   * @throws NotFoundError for an order that does not exist.
   */
  recordDelivery(delivery: {
    orderId: OrderId;
    dispatchedAt: Date;
    deliveredAt: Date;
  }): Promise<ShipmentOutcome> {
    return this.transactions.run(async () => {
      const order = await this.found(delivery.orderId);
      if (order.status === 'DELIVERED') return 'already-processed';
      if (order.status !== 'PAID' && order.status !== 'SHIPPED') {
        return 'unexpected';
      }
      const now = this.clock.now();
      if (order.status === 'PAID') {
        order.markShipped(delivery.dispatchedAt, now);
      }
      order.markDelivered(delivery.deliveredAt, now);
      await this.orders.save(order, now);
      return 'moved';
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
