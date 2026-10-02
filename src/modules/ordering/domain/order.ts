import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import { EmptyCartError, UnknownOrderLineError } from './ordering-errors.js';
import type { PublicCode } from './public-code.js';

export type OrderId = Id<'Order'>;

/** A customer of Identity, known here only by its ID (ADR-0005). */
export type CustomerId = Id<'User'>;

/** A variant of Catalog, known here only by its ID (ADR-0005). */
export type VariantId = Id<'Variant'>;

/** The cart of Shopping an order was placed from (ADR-0054). */
export type CartId = Id<'Cart'>;

/** The reservation of Inventory that holds the stock of an unpaid order (ADR-0128). */
export type ReservationId = Id<'Reservation'>;

/** BR-ORD-05, ADR-0009, ADR-0051; the transitions are in REQUIREMENTS.md §3.1. */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'AWAITING_MANUAL_FULFILLMENT',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The options of a variant, by name, such as `{ talla: 'M' }`. */
export type VariantOptions = Readonly<Record<string, string>>;

/** A line priced when the order is placed: the snapshot the order keeps (BR-ORD-03, BR-TAX-04). */
export interface PricedLine {
  readonly variantId: VariantId;
  readonly sku: string;
  readonly productName: string;
  readonly variantOptions: VariantOptions;
  /** VAT included (ADR-0008). */
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly taxRateBp: number;
  /** The VAT contained in the line total, rounded by line (BR-TAX-02). */
  readonly taxAmount: Money;
  readonly lineTotal: Money;
}

/** The total and the VAT of a line, with its price VAT included (ADR-0008, ADR-0094). */
export function priceLine(
  item: Omit<PricedLine, 'taxRateBp' | 'taxAmount' | 'lineTotal'>,
  taxRateBp: number,
): PricedLine {
  const lineTotal = item.unitPrice.multiply(item.quantity);
  return {
    ...item,
    taxRateBp,
    taxAmount: lineTotal.containedTax(taxRateBp),
    lineTotal,
  };
}

/** The shipping of an order, as Shipping quotes it (ADR-0079, ADR-0083, BR-SHP-06). */
export interface OrderShipping {
  /** VAT included; zero when shipping is free. */
  readonly cost: Money;
  readonly taxAmount: Money;
  readonly taxRateBp: number;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
}

export interface OrderTotals {
  /** The lines, VAT included. */
  readonly subtotal: Money;
  /** The VAT contained in the subtotal and the shipping cost; informative (BR-TAX-06). */
  readonly taxTotal: Money;
  readonly shippingCost: Money;
  readonly shippingTaxAmount: Money;
  /** Always zero in the MVP (ADR-0018). */
  readonly discountTotal: Money;
  readonly grandTotal: Money;
}

/** Subtotal + shipping − discount, with the VAT contained in both (BR-ORD-16, BR-TAX-06). */
export function orderTotals(
  lines: readonly PricedLine[],
  shipping: { readonly cost: Money; readonly taxAmount: Money },
): OrderTotals {
  const zero = Money.zero('MXN');
  const subtotal = lines.reduce((sum, line) => sum.add(line.lineTotal), zero);
  const linesTax = lines.reduce((sum, line) => sum.add(line.taxAmount), zero);
  return {
    subtotal,
    taxTotal: linesTax.add(shipping.taxAmount),
    shippingCost: shipping.cost,
    shippingTaxAmount: shipping.taxAmount,
    discountTotal: zero,
    grandTotal: subtotal.add(shipping.cost).subtract(zero),
  };
}

/** The address an order ships to, with the names of its state and municipality (ADR-0057). */
export interface ShippingAddress {
  readonly recipientName: string;
  readonly phone: string;
  readonly street: string;
  readonly exteriorNumber: string;
  readonly interiorNumber: string | null;
  readonly neighborhood: string;
  readonly postalCode: string;
  readonly stateCode: string;
  readonly stateName: string;
  readonly municipalityCode: string;
  readonly municipalityName: string;
  readonly city: string | null;
  readonly references: string | null;
  readonly country: 'MX';
}

export type OrderLineId = Id<'OrderLine'>;

export interface OrderLine extends PricedLine {
  /** UUIDv7, so the lines of an order sort by their number too; its shipment names them (ADR-0140). */
  readonly id: OrderLineId;
  /** From 1, in the order of the cart. */
  readonly lineNumber: number;
}

/** Who places the order: a customer, whose contact is the account email, or a guest (BR-ORD-04). */
export type Buyer =
  | {
      readonly customerId: CustomerId;
      readonly contactEmail: string;
    }
  | {
      readonly customerId: null;
      readonly contactEmail: string;
      /** The privacy notice shown to the guest (ADR-0067). */
      readonly privacyNoticeVersion: string;
    };

/** The contact email as an order keeps it, and as a guest finds the order with it: trimmed, in lowercase. */
export function normalizedContactEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Why the stock of an order comes back (ADR-0069): the order was cancelled, or its shipment came back. */
export type RestockReason = 'ORDER_CANCELLED' | 'SHIPMENT_RETURNED';

export const RESTOCK_REASONS: readonly RestockReason[] = [
  'ORDER_CANCELLED',
  'SHIPMENT_RETURNED',
];

/** A line of an order whose units come back to the stock: its variant, what it sold and what comes back. */
export interface RestockLine {
  readonly orderLineId: OrderLineId;
  readonly variantId: VariantId;
  /** Its quantity: Inventory counts it only once the stock of the order was confirmed (ADR-0142). */
  readonly sold: number;
  readonly quantity: number;
}

/** A staff member of Identity, known here only by its ID (ADR-0005). */
export type StaffId = Id<'User'>;

/** An entry of the status history (`order_status_history`): who moved the order, and why. */
export interface StatusChange {
  /** `null` when the order is created. */
  readonly from: OrderStatus | null;
  readonly to: OrderStatus;
  /** The staff member or customer; `null` for the system. */
  readonly actorId: Id<'User'> | null;
  readonly reason: string | null;
  readonly at: Date;
}

export interface OrderSnapshot {
  readonly id: OrderId;
  readonly publicCode: PublicCode;
  /** `null` for a guest order. */
  readonly customerId: CustomerId | null;
  /** In lowercase; `null` only once anonymized (ADR-0067). */
  readonly contactEmail: string | null;
  readonly privacyNoticeVersion: string | null;
  readonly status: OrderStatus;
  readonly lines: readonly OrderLine[];
  readonly totals: OrderTotals;
  readonly shippingTaxRateBp: number;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
  readonly shippingAddress: ShippingAddress;
  /** The reservation that holds or held its stock; a late payment opens another (ADR-0012). */
  readonly reservationId: ReservationId | null;
  /** When the first reservation ends: the order expires then if it is not paid (BR-ORD-07). */
  readonly paymentDueAt: Date;
  readonly sourceCartId: CartId;
  readonly placedAt: Date;
  /** When the payment was captured, also when the order could not be fulfilled or was cancelled first. */
  readonly paidAt: Date | null;
  /** When its shipment left (ADR-0141). */
  readonly shippedAt: Date | null;
  /** When its shipment was delivered (ADR-0141). */
  readonly deliveredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly expiredAt: Date | null;
  /** When its refund completed: the money went back (ADR-0051). */
  readonly refundedAt: Date | null;
  readonly version: number;
}

/**
 * An order (DOMAIN_MODEL.md, Ordering). It is born PENDING_PAYMENT with the stock reserved, and keeps as a
 * snapshot what it sold and at what price, so later changes of the catalog, the prices or the shipping never
 * alter it (BR-ORD-03, BR-ORD-13). The totals come only from its lines and shipping (BR-ORD-02). Only the
 * transitions of REQUIREMENTS.md §3.1 happen, each one kept in its history (BR-ORD-05).
 */
export class Order {
  private readonly changes: StatusChange[] = [];
  private changed = false;

  private constructor(private state: OrderSnapshot) {}

  /**
   * A new order in PENDING_PAYMENT (UC-ORD-02), with its lines numbered in the order given.
   *
   * @throws EmptyCartError without lines (BR-ORD-01); InvalidValueError for a guest without the version of
   *   the privacy notice (ADR-0067) or a blank contact email.
   */
  static place(input: {
    id: OrderId;
    publicCode: PublicCode;
    buyer: Buyer;
    lines: readonly PricedLine[];
    shipping: OrderShipping;
    shippingAddress: ShippingAddress;
    reservation: { readonly id: ReservationId; readonly expiresAt: Date };
    sourceCartId: CartId;
    now: Date;
  }): Order {
    if (input.lines.length === 0) throw new EmptyCartError();
    const contactEmail = normalizedContactEmail(input.buyer.contactEmail);
    if (contactEmail === '') {
      throw new InvalidValueError('An order needs a contact email');
    }
    const privacyNoticeVersion =
      input.buyer.customerId === null
        ? input.buyer.privacyNoticeVersion.trim()
        : null;
    if (privacyNoticeVersion === '') {
      throw new InvalidValueError(
        'A guest order needs the version of the privacy notice',
      );
    }
    return new Order({
      id: input.id,
      publicCode: input.publicCode,
      customerId: input.buyer.customerId,
      contactEmail,
      privacyNoticeVersion,
      status: 'PENDING_PAYMENT',
      lines: input.lines.map((line, index) => ({
        ...line,
        id: newId<'OrderLine'>(),
        lineNumber: index + 1,
      })),
      totals: orderTotals(input.lines, input.shipping),
      shippingTaxRateBp: input.shipping.taxRateBp,
      deliveryMinBusinessDays: input.shipping.deliveryMinBusinessDays,
      deliveryMaxBusinessDays: input.shipping.deliveryMaxBusinessDays,
      shippingAddress: input.shippingAddress,
      reservationId: input.reservation.id,
      paymentDueAt: input.reservation.expiresAt,
      sourceCartId: input.sourceCartId,
      placedAt: input.now,
      paidAt: null,
      shippedAt: null,
      deliveredAt: null,
      cancelledAt: null,
      expiredAt: null,
      refundedAt: null,
      version: 1,
    });
  }

  /** An order as it was saved. */
  static restore(snapshot: OrderSnapshot): Order {
    return new Order(snapshot);
  }

  get id(): OrderId {
    return this.state.id;
  }

  get publicCode(): PublicCode {
    return this.state.publicCode;
  }

  get status(): OrderStatus {
    return this.state.status;
  }

  get version(): number {
    return this.state.version;
  }

  get grandTotal(): Money {
    return this.state.totals.grandTotal;
  }

  get snapshot(): OrderSnapshot {
    return this.state;
  }

  /** The status changes since the order was read, oldest first, for its history. */
  get statusChanges(): readonly StatusChange[] {
    return this.changes;
  }

  /** Whether anything changed since it was read, so there is something to save. */
  get hasChanges(): boolean {
    return this.changed;
  }

  /**
   * Cancels an order that was not shipped (UC-ORD-07, ADR-0021, BR-CAN-01): an unpaid one is final and its
   * reservation must be released; a paid one, PAID or waiting for stock, must get its full refund, and becomes
   * REFUNDED when it completes (ADR-0051, ADR-0135).
   *
   * @throws InvalidStateTransitionError from SHIPPED on, or when it was already cancelled or expired.
   */
  cancel(actorId: StaffId, reason: string, now: Date): void {
    this.assertStatus(
      ['PENDING_PAYMENT', 'PAID', 'AWAITING_MANUAL_FULFILLMENT'],
      'cancel',
    );
    this.move('CANCELLED', actorId, reason, now);
    this.state = { ...this.state, cancelledAt: now };
  }

  /**
   * The payment was captured and the stock is the order's (UC-ORD-09, BR-ORD-08 and 09): PAID, paid when the
   * payment was captured. A late payment brings the reservation it opened.
   *
   * @throws InvalidStateTransitionError unless the order is PENDING_PAYMENT or EXPIRED.
   */
  markPaid(
    capturedAt: Date,
    now: Date,
    reservationId: ReservationId | null = null,
  ): void {
    this.assertStatus(['PENDING_PAYMENT', 'EXPIRED'], 'mark paid');
    this.move('PAID', null, null, now);
    this.state = {
      ...this.state,
      paidAt: capturedAt,
      reservationId: reservationId ?? this.state.reservationId,
    };
  }

  /**
   * A payment arrived when there was no stock to reserve for it (BR-ORD-09, ADR-0012): the staff gets more
   * stock and retries, or cancels with a refund.
   *
   * @throws InvalidStateTransitionError unless the order is PENDING_PAYMENT or EXPIRED.
   */
  awaitManualFulfillment(capturedAt: Date, now: Date): void {
    this.assertStatus(
      ['PENDING_PAYMENT', 'EXPIRED'],
      'await manual fulfillment',
    );
    this.move('AWAITING_MANUAL_FULFILLMENT', null, null, now);
    this.state = { ...this.state, paidAt: capturedAt };
  }

  /**
   * The staff got the stock of an order that waited for it (UC-ORD-08, ADR-0012): PAID, still paid when its
   * payment was captured.
   *
   * @throws InvalidStateTransitionError unless the order is AWAITING_MANUAL_FULFILLMENT.
   */
  fulfillManually(
    actorId: StaffId,
    reservationId: ReservationId,
    now: Date,
  ): void {
    this.assertStatus(['AWAITING_MANUAL_FULFILLMENT'], 'retry fulfillment');
    this.move('PAID', actorId, null, now);
    this.state = { ...this.state, reservationId };
  }

  /**
   * A payment captured after the order was cancelled (ADR-0133): it stays CANCELLED, now with a captured
   * payment, so it waits for its refund (ADR-0051).
   *
   * @returns false, changing nothing, when the order already had a payment.
   * @throws InvalidStateTransitionError unless the order is CANCELLED.
   */
  recordPaymentAfterCancellation(capturedAt: Date): boolean {
    this.assertStatus(['CANCELLED'], 'record a payment');
    if (this.state.paidAt !== null) return false;
    this.state = { ...this.state, paidAt: capturedAt };
    this.changed = true;
    return true;
  }

  /**
   * The order was not paid in time (UC-ORD-10, BR-ORD-07): once its payment is due, a PENDING_PAYMENT order
   * becomes EXPIRED, and its reservation must expire with it. A late payment can still pay it (ADR-0012).
   *
   * @returns false, changing nothing, unless it is PENDING_PAYMENT with its payment due.
   */
  expireIfDue(now: Date): boolean {
    if (
      this.state.status !== 'PENDING_PAYMENT' ||
      this.state.paymentDueAt > now
    ) {
      return false;
    }
    this.move('EXPIRED', null, null, now);
    this.state = { ...this.state, expiredAt: now };
    return true;
  }

  /**
   * Its shipment left (UC-SHI-05, ADR-0141): SHIPPED, shipped when the shipment left. From then on it is not
   * cancelled (BR-CAN-01).
   *
   * @throws InvalidStateTransitionError unless the order is PAID.
   */
  markShipped(dispatchedAt: Date, now: Date): void {
    this.assertStatus(['PAID'], 'mark shipped');
    this.move('SHIPPED', null, null, now);
    this.state = { ...this.state, shippedAt: dispatchedAt };
  }

  /**
   * Its shipment was delivered (UC-SHI-06, ADR-0141): DELIVERED, final.
   *
   * @throws InvalidStateTransitionError unless the order is SHIPPED.
   */
  markDelivered(deliveredAt: Date, now: Date): void {
    this.assertStatus(['SHIPPED'], 'mark delivered');
    this.move('DELIVERED', null, null, now);
    this.state = { ...this.state, deliveredAt };
  }

  /**
   * The refund of a cancelled order completed (ADR-0051): REFUNDED, when the money went back.
   *
   * @throws InvalidStateTransitionError unless the order is CANCELLED with a captured payment.
   */
  markRefunded(completedAt: Date, now: Date): void {
    if (this.state.status !== 'CANCELLED' || this.state.paidAt === null) {
      throw new InvalidStateTransitionError(this.state.status, 'mark refunded');
    }
    this.move('REFUNDED', null, null, now);
    this.state = { ...this.state, refundedAt: completedAt };
  }

  /**
   * Its stock can come back for `reason` (UC-INV-09, ADR-0052, ADR-0053): a cancelled or refunded order, or one
   * whose shipment came back.
   *
   * @throws InvalidStateTransitionError with the status of the order, or for a return with that of its shipment
   *   (the order's when it has none).
   */
  assertRestockable(
    reason: RestockReason,
    shipmentStatus: string | null,
  ): void {
    if (reason === 'ORDER_CANCELLED') {
      this.assertStatus(['CANCELLED', 'REFUNDED'], 'restock');
    } else if (shipmentStatus !== 'RETURNED') {
      throw new InvalidStateTransitionError(
        shipmentStatus ?? this.state.status,
        'restock the return',
      );
    }
  }

  /**
   * The lines to restock, each with its variant and what it sold (UC-INV-09): those asked, or every line in full.
   *
   * @throws UnknownOrderLineError for a line that is not of this order.
   */
  linesToRestock(
    requested?: readonly { orderLineId: OrderLineId; quantity: number }[],
  ): RestockLine[] {
    const toRestock = (line: OrderLine, quantity: number): RestockLine => ({
      orderLineId: line.id,
      variantId: line.variantId,
      sold: line.quantity,
      quantity,
    });
    if (requested === undefined) {
      return this.state.lines.map((line) => toRestock(line, line.quantity));
    }
    return requested.map(({ orderLineId, quantity }, index) => {
      const line = this.state.lines.find(({ id }) => id === orderLineId);
      if (line === undefined) throw new UnknownOrderLineError(index);
      return toRestock(line, quantity);
    });
  }

  private assertStatus(allowed: readonly OrderStatus[], action: string): void {
    if (!allowed.includes(this.state.status)) {
      throw new InvalidStateTransitionError(this.state.status, action);
    }
  }

  private move(
    to: OrderStatus,
    actorId: Id<'User'> | null,
    reason: string | null,
    at: Date,
  ): void {
    this.changes.push({ from: this.state.status, to, actorId, reason, at });
    this.state = { ...this.state, status: to };
    this.changed = true;
  }
}
