import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  OrderId,
  PaymentAttempt,
  PaymentId,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../domain/payment.js';

/** A refund of a payment (ADR-0051); T-190 part b creates them. */
export interface RefundView {
  readonly id: string;
  readonly amount: Money;
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED';
  readonly providerRefundId: string | null;
  readonly registeredBy: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

/** The payment of an order, as the order shows it (API_SPEC.md §8.8 and §8.9). */
export interface PaymentView {
  readonly id: PaymentId;
  readonly orderId: OrderId;
  readonly provider: PaymentProvider;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly capturedAmount: Money;
  readonly refundedAmount: Money;
  readonly capturedAt: Date | null;
  /** How the store collected a captured manual payment; `null` otherwise, or when the staff did not say (ADR-0161). */
  readonly method: PaymentMethod | null;
  readonly refunds: readonly RefundView[];
}

/** `AdminPayment` of API_SPEC.md §16.3. */
export interface AdminPaymentView extends PaymentView {
  /** The public code of the order, without the dash. */
  readonly orderCode: string;
  readonly providerPaymentId: string | null;
  /** Oldest first. */
  readonly attempts: readonly PaymentAttempt[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface PaymentFilter {
  /** Any of these. */
  readonly status?: readonly PaymentStatus[];
  readonly provider?: readonly PaymentProvider[];
  readonly orderId?: OrderId;
  readonly capturedFrom?: Date;
  readonly capturedTo?: Date;
}

export type PaymentSortField = 'createdAt' | 'amount';

/**
 * Read models of Payments, straight from its tables. An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class PaymentsQueries {
  /** The payments of these orders, by order; an order without one is left out. */
  abstract paymentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, PaymentView>>;

  abstract findPayment(id: PaymentId): Promise<AdminPaymentView | null>;

  /** Every payment, for the staff; ties are broken by ID. */
  abstract listPayments(
    filter: PaymentFilter,
    sort: readonly SortOrder<PaymentSortField>[],
    page: PageRequest,
  ): Promise<Page<AdminPaymentView>>;
}
