import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  CustomerId,
  OrderAddress,
  OrderId,
  OrderLineId,
  OrderStatus,
  OrderTotals,
  ShippingAddress,
  VariantOptions,
} from '../domain/order.js';
import type { PublicCode } from '../domain/public-code.js';

/** A line of an order, as it was sold (BR-ORD-03). */
export interface OrderLineView {
  /** Only for the staff, who names it to restock (ADR-0142). */
  readonly id: OrderLineId;
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

/** An order as its buyer sees it: never an anonymized one (ADR-0067). */
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

/** An entry of the status history of an order. */
export interface StatusHistoryView {
  /** `null` when the order was placed. */
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  /** The staff member or customer; `null` for the system. */
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/** An order as the staff lists it (UC-ORD-06): with its internal number, without lines nor history. */
export interface AdminOrderSummaryView extends OrderSummaryView {
  readonly orderNumber: number;
  readonly version: number;
  readonly anonymizedAt: Date | null;
  /** When the data of its buyer was blocked (ADR-0070); its email and address show as anonymized then. */
  readonly blockedAt: Date | null;
  /** Whole until the order is blocked or anonymized (ADR-0067, ADR-0070). */
  readonly shippingAddress: OrderAddress;
}

/** An order as the staff sees it (UC-ORD-06), with its lines and its status history, oldest first. */
export interface AdminOrderView extends AdminOrderSummaryView {
  readonly lines: readonly OrderLineView[];
  readonly statusHistory: readonly StatusHistoryView[];
}

export interface OrderFilter {
  /** The internal number or the public code, exact, or part of the contact email (ADR-0133). */
  readonly q?: string;
  /** Any of these. */
  readonly status?: readonly OrderStatus[];
  readonly customerId?: CustomerId;
  /** `true` for guest orders only, `false` for customers' only. */
  readonly guest?: boolean;
  readonly placedFrom?: Date;
  readonly placedTo?: Date;
  /** `true` for the cancelled orders with a captured payment, which wait for their refund (ADR-0051). */
  readonly hasPendingRefund?: boolean;
}

export type OrderSortField = 'placedAt' | 'orderNumber' | 'grandTotal';

/**
 * Read models of Ordering, straight from its tables. An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class OrderingQueries {
  /** An order for its buyer; `null` if it does not exist, or was blocked or anonymized (ADR-0070). */
  abstract findOrder(id: OrderId): Promise<OrderView | null>;

  /**
   * One of the customer's orders by its public code; another customer's order, or a blocked or anonymized one, is
   * answered as missing (ADR-0070).
   */
  abstract findCustomerOrder(
    customerId: CustomerId,
    publicCode: PublicCode,
  ): Promise<OrderView | null>;

  /**
   * A guest order by its public code and contact email, in a single query (UC-ORD-04, ADR-0138): `null` alike
   * when no order has the code, the email is another one, the order is a customer's (BR-ORD-11), or it was blocked
   * (ADR-0070).
   */
  abstract findGuestOrder(
    publicCode: PublicCode,
    contactEmail: string,
  ): Promise<OrderView | null>;

  /**
   * Whether the email has a guest order, to send it an access link (UC-ORD-05, ADR-0148). An anonymized order no
   * longer has the email.
   */
  abstract hasGuestOrders(contactEmail: string): Promise<boolean>;

  /** The newest `limit` guest orders of the email, newest first; ties are broken by ID (UC-ORD-05, ADR-0148). */
  abstract listGuestOrders(
    contactEmail: string,
    limit: number,
  ): Promise<readonly OrderSummaryView[]>;

  /** An order for the staff (UC-ORD-06); `null` if it does not exist. */
  abstract findAdminOrder(id: OrderId): Promise<AdminOrderView | null>;

  /** Every order, for the staff (UC-ORD-06); ties are broken by ID. */
  abstract listOrders(
    filter: OrderFilter,
    sort: readonly SortOrder<OrderSortField>[],
    page: PageRequest,
  ): Promise<Page<AdminOrderSummaryView>>;

  /** The customer's orders but the blocked and anonymized ones (UC-ORD-03, ADR-0070); ties are broken by ID. */
  abstract listCustomerOrders(
    customerId: CustomerId,
    filter: CustomerOrderFilter,
    sort: readonly SortOrder<CustomerOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<OrderSummaryView>>;
}
