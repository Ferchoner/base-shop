import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  AppliedPromotion,
  CustomerId,
  OrderAddress,
  OrderChannel,
  OrderFulfillment,
  OrderId,
  OrderLineId,
  OrderStatus,
  OrderTotals,
  ShippingAddress,
  StaffId,
  VariantId,
  VariantOptions,
  WarehouseId,
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
  /** The VAT contained in the line total less its discount (ADR-0168). */
  readonly taxAmount: Money;
  readonly lineTotal: Money;
  /** What the promotion of the order took off the line (ADR-0168). */
  readonly discountAmount: Money;
  /** What was sold, for a line at the price the staff typed (ADR-0171); `null` otherwise. */
  readonly note: string | null;
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
  readonly fulfillment: OrderFulfillment;
  /** `null` for an order handed over in the store (ADR-0161). */
  readonly deliveryMinBusinessDays: number | null;
  readonly deliveryMaxBusinessDays: number | null;
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
  /** The promotion of its discount, with the name the customer saw; `null` without one (ADR-0168). */
  readonly promotion: AppliedPromotion | null;
  /** `null` for an order handed over in the store (ADR-0161). */
  readonly shippingAddress: ShippingAddress | null;
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
  readonly channel: OrderChannel;
  /** The staff member who placed a store order; `null` for an online one (ADR-0161). */
  readonly placedBy: StaffId | null;
  /** The warehouse the staff chose for a store order; `null` for an online one. */
  readonly warehouseId: WarehouseId | null;
  readonly anonymizedAt: Date | null;
  /** When the data of its buyer was blocked (ADR-0070); its email and address show as anonymized then. */
  readonly blockedAt: Date | null;
  /** Whole until the order is blocked or anonymized (ADR-0067, ADR-0070); `null` for one handed over in the store. */
  readonly shippingAddress: OrderAddress | null;
}

/** An order as the staff sees it (UC-ORD-06), with its lines and its status history, oldest first. */
export interface AdminOrderView extends AdminOrderSummaryView {
  readonly lines: readonly OrderLineView[];
  /** The promotion of its discount, with the name the customer saw; `null` without one (ADR-0168). */
  readonly promotion: AppliedPromotion | null;
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
  readonly channel?: OrderChannel;
  /** The orders this staff member placed in the store (ADR-0161). */
  readonly placedBy?: StaffId;
}

export type OrderSortField = 'placedAt' | 'orderNumber' | 'grandTotal';

/** A line sold at an open price in the physical store (ADR-0171), with its order, to know what to add to the catalog. */
export interface OpenPriceLineView {
  readonly orderId: OrderId;
  readonly publicCode: PublicCode;
  readonly orderNumber: number;
  readonly status: OrderStatus;
  readonly warehouseId: WarehouseId | null;
  readonly placedBy: StaffId | null;
  readonly placedAt: Date;
  readonly lineNumber: number;
  readonly sku: string;
  readonly productName: string;
  readonly variantOptions: VariantOptions;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly lineTotal: Money;
  readonly note: string;
}

export interface OpenPriceLineFilter {
  readonly warehouseId?: WarehouseId;
  readonly placedFrom?: Date;
  readonly placedTo?: Date;
}

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

  /**
   * Whether the customer has an order that has not concluded (ADR-0145, ADR-0152): one on its way, or cancelled with
   * its refund pending. An inactive customer with one is not anonymized.
   */
  abstract hasOpenOrders(customerId: CustomerId): Promise<boolean>;

  /**
   * The orders placed in the physical store among these IDs (ADR-0161), oldest first; online orders and unknown IDs
   * are left out. For the sales that pay for a work order (ADR-0167).
   */
  abstract storeOrders(
    ids: readonly OrderId[],
  ): Promise<readonly AdminOrderSummaryView[]>;

  /**
   * The store orders of the warehouse placed or cancelled from `from`, included, to `to`, excluded, oldest first: the
   * orders of a day of its cash closing (ADR-0171).
   */
  abstract storeDayOrders(
    warehouseId: WarehouseId,
    from: Date,
    to: Date,
  ): Promise<readonly AdminOrderSummaryView[]>;

  /**
   * How many lines were sold at an open price, and their total in cents, in the store orders of the warehouse placed
   * from `from` to `to`, excluded, that were not cancelled, refunded nor expired (ADR-0171).
   */
  abstract openPriceTotals(
    warehouseId: WarehouseId,
    from: Date,
    to: Date,
  ): Promise<{ readonly count: number; readonly amount: number }>;

  /**
   * What each variant sold in the orders placed from `from`, included, to `to`, excluded, online and in the store,
   * that were paid and not cancelled, expired nor refunded (ADR-0173): its units, and the totals of its lines less their
   * discounts, in cents. A variant that sold nothing is left out.
   */
  abstract salesByVariant(
    from: Date,
    to: Date,
  ): Promise<
    readonly { variantId: VariantId; amount: number; units: number }[]
  >;

  /** The newest `limit` guest orders of the email, newest first; ties are broken by ID (UC-ORD-05, ADR-0148). */
  abstract listGuestOrders(
    contactEmail: string,
    limit: number,
  ): Promise<readonly OrderSummaryView[]>;

  /** An order for the staff (UC-ORD-06); `null` if it does not exist. */
  abstract findAdminOrder(id: OrderId): Promise<AdminOrderView | null>;

  /**
   * The lines sold at an open price (ADR-0171), newest order first and by line number, whatever the status of the
   * order.
   */
  abstract listOpenPriceLines(
    filter: OpenPriceLineFilter,
    page: PageRequest,
  ): Promise<Page<OpenPriceLineView>>;

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
