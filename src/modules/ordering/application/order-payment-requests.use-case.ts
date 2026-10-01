import { Injectable } from '@nestjs/common';
import {
  InvalidStateTransitionError,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  CartId,
  CustomerId,
  Order,
  OrderId,
  StaffId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';
import {
  OrderPayments,
  type PaymentProvider,
  type PaymentStart,
} from './payment-ports.js';

/** Who asks to pay: the guest, with the cart the order came from, or the signed-in customer. */
export type Payer =
  { readonly guestCartId: CartId } | { readonly customerId: CustomerId };

/**
 * The payment of an order, asked by its buyer or registered by the staff (UC-PAY-01 and 02, ADR-0134). Ordering
 * checks the order, locked, and Payments collects its total: Payments never reads orders.
 */
@Injectable()
export class OrderPaymentRequests {
  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: OrderPayments,
    private readonly transactions: TransactionManager,
  ) {}

  /**
   * Starts the payment of an unpaid order (UC-PAY-01), or answers the one already started with the provider.
   *
   * @throws ProviderNotEnabledError, before anything else; NotFoundError when the order does not exist or is
   *   not the payer's (API_SPEC.md §16.2); InvalidStateTransitionError unless the order is PENDING_PAYMENT.
   */
  async startPayment(input: {
    publicCode: PublicCode;
    payer: Payer;
    provider: PaymentProvider;
  }): Promise<PaymentStart> {
    this.payments.assertProviderEnabled(input.provider);
    return this.transactions.run(async () => {
      const order = await this.orders.lockByPublicCode(input.publicCode);
      if (order === null || !paidBy(order, input.payer)) {
        throw new NotFoundError('Order', input.publicCode);
      }
      if (order.status !== 'PENDING_PAYMENT') {
        throw new InvalidStateTransitionError(order.status, 'start a payment');
      }
      return this.payments.start(order, input.provider);
    });
  }

  /**
   * Registers a payment made in the store for the total of an unpaid or expired order (UC-PAY-02, ADR-0055).
   * The order follows the normal or the late payment flow in the background, when `PaymentCaptured` arrives.
   *
   * @throws ManualPaymentsDisabledError, before anything else; NotFoundError; InvalidStateTransitionError for
   *   another status of the order, or a payment already captured.
   */
  async captureManually(input: {
    orderId: OrderId;
    staffId: StaffId;
    reference: string;
    note: string | null;
  }): Promise<void> {
    this.payments.assertManualCaptureEnabled();
    return this.transactions.run(async () => {
      const order = await this.orders.lock(input.orderId);
      if (order === null) throw new NotFoundError('Order', input.orderId);
      if (order.status !== 'PENDING_PAYMENT' && order.status !== 'EXPIRED') {
        throw new InvalidStateTransitionError(
          order.status,
          'register a manual payment',
        );
      }
      await this.payments.captureManually(order, {
        reference: input.reference,
        note: input.note,
        registeredBy: input.staffId,
      });
    });
  }
}

/** A guest pays with the cart the order came from; a customer, only their own orders. */
function paidBy(order: Order, payer: Payer): boolean {
  const { customerId, sourceCartId } = order.snapshot;
  return 'customerId' in payer
    ? customerId === payer.customerId
    : customerId === null && sourceCartId === payer.guestCartId;
}
