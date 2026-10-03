import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  Money,
  newId,
} from '../../../shared-kernel/index.js';
import {
  ActiveOrdersExistError,
  EmptyCartError,
  UnknownOrderLineError,
} from './ordering-errors.js';
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

/** The fields of an address that tell who receives it and where exactly: anonymization removes them (ADR-0067). */
type IdentifyingField =
  | 'recipientName'
  | 'phone'
  | 'street'
  | 'exteriorNumber'
  | 'interiorNumber'
  | 'neighborhood'
  | 'city'
  | 'references';

/**
 * The address of an anonymized order (ADR-0067): it keeps the state, the municipality and the postal code, and the
 * country, which is always Mexico; the rest is `null`.
 */
export type AnonymizedAddress = Omit<ShippingAddress, IdentifyingField> & {
  readonly [Field in IdentifyingField]: null;
};

/** The address an order keeps: whole, until the order is anonymized. */
export type OrderAddress = ShippingAddress | AnonymizedAddress;

/**
 * An address without who receives it nor where exactly: the state, the municipality, the postal code and the country.
 * What an anonymized order keeps, and what a blocked one shows the staff (ADR-0067, ADR-0070).
 */
export function withoutIdentifyingFields(
  address: OrderAddress,
): AnonymizedAddress {
  return {
    recipientName: null,
    phone: null,
    street: null,
    exteriorNumber: null,
    interiorNumber: null,
    neighborhood: null,
    postalCode: address.postalCode,
    stateCode: address.stateCode,
    stateName: address.stateName,
    municipalityCode: address.municipalityCode,
    municipalityName: address.municipalityName,
    city: null,
    references: null,
    country: address.country,
  };
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
  readonly shippingAddress: OrderAddress;
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
  /** When the data of its buyer was removed (ADR-0067); `null` until then. */
  readonly anonymizedAt: Date | null;
  /**
   * When it concluded (`isConcluded`): the start of the retention of the data of its buyer (ADR-0070, ADR-0151).
   * `null` while it may still change, also once a late payment reopens it.
   */
  readonly concludedAt: Date | null;
  /** When the data of its buyer was blocked: hidden from the usual responses until it is anonymized (ADR-0070). */
  readonly blockedAt: Date | null;
  readonly version: number;
}

/**
 * What a payment clears when it reopens an order that had concluded, expired or cancelled without one: it has not
 * concluded any more, and the data of its buyer is no longer blocked (ADR-0151).
 */
const reopened = { concludedAt: null, blockedAt: null } as const;

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
      anonymizedAt: null,
      concludedAt: null,
      blockedAt: null,
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

  /** Whether the data of its buyer was removed (ADR-0067). */
  get isAnonymized(): boolean {
    return this.state.anonymizedAt !== null;
  }

  /** Whether the data of its buyer is blocked (ADR-0070): its buyer no longer sees it, and the staff sees it hidden. */
  get isBlocked(): boolean {
    return this.state.blockedAt !== null;
  }

  /** Whether it concluded at `cutoff` or before (ADR-0151). */
  concludedBy(cutoff: Date): boolean {
    const { concludedAt } = this.state;
    return concludedAt !== null && concludedAt.getTime() <= cutoff.getTime();
  }

  /**
   * Where it ships (UC-SHI-03).
   *
   * @throws Error for an anonymized order: it is never paid, so it never ships (ADR-0145).
   */
  get deliveryAddress(): ShippingAddress {
    const address = this.state.shippingAddress;
    if (address.recipientName === null) {
      throw new Error('An anonymized order has no address to ship to');
    }
    return address;
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
    // A paid one concludes with its refund (ADR-0145).
    this.state = {
      ...this.state,
      cancelledAt: now,
      concludedAt: this.state.paidAt === null ? now : null,
    };
  }

  /**
   * The payment was captured and the stock is the order's (UC-ORD-09, BR-ORD-08 and 09): PAID, paid when the
   * payment was captured. A late payment brings the reservation it opened.
   *
   * @throws InvalidStateTransitionError unless the order is PENDING_PAYMENT or EXPIRED, or when it was anonymized:
   *   it has no address to ship to (ADR-0145).
   */
  markPaid(
    capturedAt: Date,
    now: Date,
    reservationId: ReservationId | null = null,
  ): void {
    this.assertStatus(['PENDING_PAYMENT', 'EXPIRED'], 'mark paid');
    this.assertNotAnonymized('pay an anonymized order');
    this.move('PAID', null, null, now);
    this.state = {
      ...this.state,
      paidAt: capturedAt,
      reservationId: reservationId ?? this.state.reservationId,
      ...reopened,
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
    this.state = { ...this.state, paidAt: capturedAt, ...reopened };
  }

  /**
   * Whether the staff can retry the fulfillment of the order (UC-ORD-08), checked before looking for its stock.
   *
   * @throws InvalidStateTransitionError unless the order is AWAITING_MANUAL_FULFILLMENT, or when it was anonymized:
   *   the staff can only cancel it, with its refund (ADR-0145).
   */
  assertFulfillable(): void {
    this.assertStatus(['AWAITING_MANUAL_FULFILLMENT'], 'retry fulfillment');
    this.assertNotAnonymized('fulfill an anonymized order');
  }

  /**
   * The staff got the stock of an order that waited for it (UC-ORD-08, ADR-0012): PAID, still paid when its
   * payment was captured.
   *
   * @throws InvalidStateTransitionError as `assertFulfillable`.
   */
  fulfillManually(
    actorId: StaffId,
    reservationId: ReservationId,
    now: Date,
  ): void {
    this.assertFulfillable();
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
    this.state = { ...this.state, paidAt: capturedAt, ...reopened };
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
    this.state = { ...this.state, expiredAt: now, concludedAt: now };
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
    this.state = { ...this.state, deliveredAt, concludedAt: deliveredAt };
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
    this.state = {
      ...this.state,
      refundedAt: completedAt,
      concludedAt: completedAt,
    };
  }

  /**
   * Its shipment came back (UC-SHI-09, ADR-0053): a SHIPPED order stays SHIPPED, but concludes then (ADR-0145).
   *
   * @returns false, changing nothing, unless it is SHIPPED and had not concluded.
   */
  recordReturn(returnedAt: Date): boolean {
    if (this.state.status !== 'SHIPPED' || this.state.concludedAt !== null) {
      return false;
    }
    this.state = { ...this.state, concludedAt: returnedAt };
    this.changed = true;
    return true;
  }

  /**
   * Blocks the data of its buyer once its operational phase ended (ADR-0070, ADR-0151): it concluded at `cutoff` or
   * before. The data stays, hidden from the usual responses, until it is anonymized.
   *
   * @returns false, changing nothing, when it has not concluded by then, or was blocked or anonymized already.
   */
  blockIfDue(cutoff: Date, at: Date): boolean {
    if (!this.concludedBy(cutoff) || this.isBlocked || this.isAnonymized) {
      return false;
    }
    this.state = { ...this.state, blockedAt: at };
    this.changed = true;
    return true;
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

  /**
   * Whether the order concluded, so the data of its buyer can be anonymized (ADR-0070, ADR-0145): DELIVERED, EXPIRED,
   * REFUNDED, or CANCELLED without a payment to refund; and SHIPPED once its shipment came back, because the order
   * stays SHIPPED then (ADR-0053).
   */
  isConcluded(shipmentStatus: string | null): boolean {
    switch (this.state.status) {
      case 'DELIVERED':
      case 'EXPIRED':
      case 'REFUNDED':
        return true;
      case 'CANCELLED':
        return this.state.paidAt === null;
      case 'SHIPPED':
        return shipmentStatus === 'RETURNED';
      default:
        return false;
    }
  }

  /**
   * Removes the data of its buyer (UC-IAM-19, ADR-0067): the contact email, and from its address everything but the
   * state, the municipality and the postal code. Its amounts, lines and status stay. A late payment of an anonymized
   * order that had expired leaves it waiting for the staff, who can only cancel it with its refund (ADR-0145).
   *
   * @throws ActiveOrdersExistError unless it concluded (`isConcluded`).
   */
  anonymize(shipmentStatus: string | null, at: Date): void {
    if (!this.isConcluded(shipmentStatus)) throw new ActiveOrdersExistError();
    this.state = {
      ...this.state,
      contactEmail: null,
      shippingAddress: withoutIdentifyingFields(this.state.shippingAddress),
      anonymizedAt: this.state.anonymizedAt ?? at,
    };
    this.changed = true;
  }

  private assertNotAnonymized(action: string): void {
    if (this.isAnonymized) {
      throw new InvalidStateTransitionError(this.state.status, action);
    }
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
