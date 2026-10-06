import type { Money } from '../../../shared-kernel/index.js';
import type { Order, OrderId, StaffId } from '../domain/order.js';

// Ordering uses Payments, and Payments never uses Ordering: Ordering checks the order and sends its total, and
// Payments answers with events (ADR-0134). An abstract class rather than an interface, so it can be the
// dependency injection token without depending on NestJS.

/** ADR-0040: the manual method, paid in the physical store (ADR-0161), and PayPal, prepared but not enabled. */
export const PAYMENT_PROVIDERS = ['MANUAL', 'PAYPAL'] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** How the store collected a manual payment (ADR-0161): cash, a card terminal or a bank transfer. */
export const PAYMENT_METHODS = ['CASH', 'CARD_TERMINAL', 'TRANSFER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A refund of the payment of an order (ADR-0051). */
export interface OrderRefund {
  readonly id: string;
  readonly amount: Money;
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED';
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

/** The payment of an order, as the order shows it (API_SPEC.md §8.8 and §8.9). */
export interface OrderPayment {
  readonly id: string;
  readonly provider: PaymentProvider;
  readonly status: string;
  readonly amount: Money;
  readonly capturedAmount: Money;
  readonly refundedAmount: Money;
  readonly capturedAt: Date | null;
  /** How the store collected a captured manual payment; `null` otherwise, or when the staff did not say (ADR-0161). */
  readonly method: PaymentMethod | null;
  readonly refunds: readonly OrderRefund[];
}

/** What the customer must do to pay: for the manual method, pay in the store (ADR-0055). */
export interface PaymentAction {
  readonly type: 'PAY_IN_STORE';
  /** The public code of the order, without the dash. */
  readonly orderCode: string;
  readonly amount: Money;
  readonly instructions: string;
}

export interface PaymentStart {
  readonly payment: OrderPayment;
  readonly action: PaymentAction;
  /** False when the payment was already started with the same provider. */
  readonly started: boolean;
}

/** The payments of Payments. */
export abstract class OrderPayments {
  /** @throws ManualPaymentsDisabledError when the staff cannot register payments made in the store. */
  abstract assertManualCaptureEnabled(): Promise<void>;

  /** @throws ProviderNotEnabledError for a provider customers cannot use now. */
  abstract assertProviderEnabled(provider: PaymentProvider): Promise<void>;

  /**
   * Starts the payment of the order for its total, or answers the one already started with the provider.
   *
   * @throws ProviderNotEnabledError; InvalidStateTransitionError for a payment with another provider or no
   *   longer pending.
   */
  abstract start(
    order: Order,
    provider: PaymentProvider,
  ): Promise<PaymentStart>;

  /**
   * Captures the total of the order as paid in the store, and publishes `PaymentCaptured`.
   *
   * @throws InvalidStateTransitionError for a payment that is not a pending manual one.
   */
  abstract captureManually(
    order: Order,
    input: {
      reference: string;
      method: PaymentMethod | null;
      note: string | null;
      registeredBy: StaffId;
    },
  ): Promise<void>;

  /**
   * Starts the full refund of the captured payment of a cancelled order (UC-PAY-03); starting it again
   * changes nothing.
   */
  abstract startRefund(orderId: OrderId): Promise<void>;

  /** Cancels the pending payment of an order cancelled before it was paid; nothing else changes. */
  abstract cancelPending(orderId: OrderId): Promise<void>;

  /** The payments of these orders, by order; an order without one is left out. */
  abstract paymentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, OrderPayment>>;
}
