import { Inject, Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  type DomainEvent,
  DomainEventPublisher,
  eventMetadata,
  InvalidStateTransitionError,
  type Money,
  newId,
  toId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type OrderId,
  Payment,
  type PaymentId,
  type PaymentProvider,
  type StaffId,
} from '../domain/payment.js';
import {
  ManualPaymentsDisabledError,
  ProviderNotEnabledError,
} from '../domain/payment-errors.js';
import { PaymentRepository } from '../domain/payment.repository.js';
import { MANUAL_PAYMENTS_ENABLED } from './manual-payments.js';
import { PaymentsQueries, type PaymentView } from './payments.queries.js';

export type { PaymentView, RefundView } from './payments.queries.js';

/** What Ordering tells of the order a payment is for: its total is the amount (BR-PAY-02). */
export interface PaymentRequest {
  readonly orderId: string;
  /** The public code, without the dash (ADR-0049). */
  readonly orderCode: string;
  readonly amount: Money;
}

/** What the customer must do to pay (API_SPEC.md §16.2): for the manual method, pay in the store (ADR-0055). */
export interface PaymentAction {
  readonly type: 'PAY_IN_STORE';
  /** The public code of the order, without the dash. */
  readonly orderCode: string;
  readonly amount: Money;
  readonly instructions: string;
}

export interface PaymentStart {
  readonly payment: PaymentView;
  readonly action: PaymentAction;
  /** False when the payment was already started with the same provider. */
  readonly started: boolean;
}

/** Published when a payment is captured; Ordering marks its order paid (UC-ORD-09, ADR-0133). */
export interface PaymentCaptured extends DomainEvent<'PaymentCaptured'> {
  readonly paymentId: PaymentId;
  readonly orderId: OrderId;
  readonly amount: Money;
}

const PAY_IN_STORE_INSTRUCTIONS =
  'Presenta este código en la tienda para pagar.';

/**
 * Public API of Payments for Ordering (ADR-0005, ADR-0134). Ordering uses Payments, and Payments never uses
 * Ordering: Ordering checks the order and sends its total, and Payments answers with events. Every operation
 * joins the transaction of its caller, which holds the order locked.
 */
@Injectable()
export class PaymentsFacade {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly queries: PaymentsQueries,
    private readonly events: DomainEventPublisher,
    private readonly audit: AuditTrail,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    @Inject(MANUAL_PAYMENTS_ENABLED) private readonly manualEnabled: boolean,
  ) {}

  /**
   * Checked before anything else, so a disabled method answers the same whatever the order (ADR-0040).
   *
   * @throws ManualPaymentsDisabledError when the staff cannot register payments made in the store.
   */
  assertManualPaymentsEnabled(): void {
    if (!this.manualEnabled) throw new ManualPaymentsDisabledError();
  }

  /**
   * Checked before reading the order, like any validation of the request (API_SPEC.md §16.2).
   *
   * @throws ProviderNotEnabledError: the manual method only when its variable turns it on, PayPal never until
   *   it is verified (BR-PAY-13).
   */
  assertProviderEnabled(provider: PaymentProvider): void {
    if (provider !== 'MANUAL' || !this.manualEnabled) {
      throw new ProviderNotEnabledError(provider);
    }
  }

  /**
   * Starts the payment of an order with a provider (UC-PAY-01), or answers the one already started with it.
   *
   * @throws ProviderNotEnabledError; InvalidStateTransitionError when the order already has a payment with
   *   another provider, or one that is no longer pending.
   */
  async start(
    order: PaymentRequest,
    provider: PaymentProvider,
  ): Promise<PaymentStart> {
    this.assertProviderEnabled(provider);
    return this.transactions.run(async () => {
      const existing = await this.payments.findByOrder(orderIdOf(order));
      if (existing !== null) {
        if (existing.provider !== provider || existing.status !== 'PENDING') {
          throw new InvalidStateTransitionError(
            existing.status,
            `start a ${provider} payment`,
          );
        }
        return this.started(existing, false);
      }
      const now = this.clock.now();
      const payment = Payment.start({
        id: newId<'Payment'>(),
        orderId: orderIdOf(order),
        orderCode: order.orderCode,
        provider,
        amount: order.amount,
        now,
      });
      await this.payments.insert(payment, now);
      return this.started(payment, true);
    });
  }

  /**
   * Registers a payment made in the store for the total of the order (UC-PAY-02, ADR-0055), creating the
   * payment when the customer never started it, and publishes `PaymentCaptured` (BR-PAY-10). Audited, with
   * the note as its reason.
   *
   * @throws ManualPaymentsDisabledError; InvalidStateTransitionError when the payment is not a pending manual
   *   one, such as one already captured.
   */
  async captureManually(
    order: PaymentRequest,
    input: { reference: string; note: string | null; registeredBy: StaffId },
  ): Promise<void> {
    this.assertManualPaymentsEnabled();
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const existing = await this.payments.findByOrder(orderIdOf(order));
      const payment =
        existing ??
        Payment.start({
          id: newId<'Payment'>(),
          orderId: orderIdOf(order),
          orderCode: order.orderCode,
          provider: 'MANUAL',
          amount: order.amount,
          now,
        });
      const before = payment.status;
      payment.captureManually({
        reference: input.reference,
        registeredBy: input.registeredBy,
        now,
      });
      if (existing === null) {
        await this.payments.insert(payment, now);
      } else {
        await this.payments.save(payment, now);
      }
      await this.audit.record({
        action: 'payments.manual-capture',
        resource: { type: 'payment', id: payment.id },
        changes: changesBetween({ status: before }, { status: payment.status }),
        ...(input.note === null ? {} : { reason: input.note }),
      });
      const captured: PaymentCaptured = {
        ...eventMetadata('PaymentCaptured', now),
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
      };
      this.events.publish(captured);
    });
  }

  /** The payments of these orders, by order; an order without one is left out. */
  paymentsOf(
    orderIds: readonly string[],
  ): Promise<ReadonlyMap<OrderId, PaymentView>> {
    return this.queries.paymentsOf(orderIds as readonly OrderId[]);
  }

  private async started(
    payment: Payment,
    started: boolean,
  ): Promise<PaymentStart> {
    const view = (await this.queries.paymentsOf([payment.orderId])).get(
      payment.orderId,
    );
    // The payment was just read or written in this transaction.
    if (view === undefined) throw new Error(`Payment ${payment.id} vanished`);
    return {
      payment: view,
      action: {
        type: 'PAY_IN_STORE',
        orderCode: payment.snapshot.orderCode,
        amount: payment.amount,
        instructions: PAY_IN_STORE_INSTRUCTIONS,
      },
      started,
    };
  }
}

function orderIdOf(order: PaymentRequest): OrderId {
  return toId<'Order'>(order.orderId);
}
