import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  CustomerId,
  OrderId,
  OrderStatus,
  OrderTotals,
  ShippingAddress,
  VariantOptions,
} from '../domain/order.js';
import type { PublicCode } from '../domain/public-code.js';

/** A line of an order, as it was sold (BR-ORD-03). */
export interface OrderLineView {
  readonly lineNumber: number;
  readonly sku: string;
  readonly productName: string;
  readonly variantOptions: VariantOptions;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly taxRateBp: number;
  readonly taxAmount: Money;
  readonly lineTotal: Money;
}

/** An order without its lines nor its address, as a listing shows it. */
export interface OrderSummaryView {
  readonly id: OrderId;
  readonly publicCode: PublicCode;
  readonly status: OrderStatus;
  readonly customerId: CustomerId | null;
  /** `null` only in anonymized orders (ADR-0067). */
  readonly contactEmail: string | null;
  readonly totals: OrderTotals;
  /** Units of every line. */
  readonly itemCount: number;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
  readonly placedAt: Date;
  /** When the reservation ends, while the order is PENDING_PAYMENT; `null` in any other status. */
  readonly paymentDueAt: Date | null;
  readonly paidAt: Date | null;
  readonly shippedAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly expiredAt: Date | null;
  readonly refundedAt: Date | null;
}

export interface OrderView extends OrderSummaryView {
  readonly lines: readonly OrderLineView[];
  readonly shippingAddress: ShippingAddress;
}

export interface CustomerOrderFilter {
  /** Any of these. */
  readonly status?: readonly OrderStatus[];
  /** Placed at or after. */
  readonly placedFrom?: Date;
  /** Placed at or before. */
  readonly placedTo?: Date;
}

export type CustomerOrderSortField = 'placedAt' | 'grandTotal';

/**
 * Read models of Ordering, straight from its tables. An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class OrderingQueries {
  abstract findOrder(id: OrderId): Promise<OrderView | null>;

  /** One of the customer's orders by its public code; another customer's order is answered as missing. */
  abstract findCustomerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<OrderView | null>;

  /** The customer's orders (UC-ORD-03); ties are broken by ID. */
  abstract listCustomerOrders(
    customerId: CustomerId,
    filter: CustomerOrderFilter,
    sort: readonly SortOrder<CustomerOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<OrderSummaryView>>;
}
