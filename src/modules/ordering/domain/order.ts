import {
  type Id,
  InvalidValueError,
  Money,
} from '../../../shared-kernel/index.js';
import { EmptyCartError } from './ordering-errors.js';
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

export interface OrderLine extends PricedLine {
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

export interface OrderSnapshot {
  readonly id: OrderId;
  readonly publicCode: PublicCode;
  /** `null` for a guest order. */
  readonly customerId: CustomerId | null;
  /** In lowercase. */
  readonly contactEmail: string;
  readonly privacyNoticeVersion: string | null;
  readonly status: OrderStatus;
  readonly lines: readonly OrderLine[];
  readonly totals: OrderTotals;
  readonly shippingTaxRateBp: number;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
  readonly shippingAddress: ShippingAddress;
  readonly reservationId: ReservationId;
  /** When the reservation ends: the order expires then if it is not paid (BR-ORD-07). */
  readonly paymentDueAt: Date;
  readonly sourceCartId: CartId;
  readonly placedAt: Date;
}

/**
 * An order (DOMAIN_MODEL.md, Ordering). It is born PENDING_PAYMENT with the stock reserved, and keeps as a
 * snapshot what it sold and at what price, so later changes of the catalog, the prices or the shipping never
 * alter it (BR-ORD-03, BR-ORD-13). The totals come only from its lines and shipping (BR-ORD-02).
 */
export class Order {
  private constructor(private readonly state: OrderSnapshot) {}

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
    const contactEmail = input.buyer.contactEmail.trim().toLowerCase();
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
    });
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

  get snapshot(): OrderSnapshot {
    return this.state;
  }
}
