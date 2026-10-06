import type { Money } from '../../../shared-kernel/index.js';

// Notifications' application layer cannot import other modules (ADR-0103): this port says what the emails need of
// an order, and an adapter in its infrastructure answers it with the facade of Ordering (ADR-0143). An abstract
// class rather than an interface, so it can be the dependency injection token without depending on NestJS.

/** An order as its emails show it (ADR-0074): the public code, never the internal number (ADR-0049). */
export interface NoticeOrder {
  /** With dash. */
  readonly publicCode: string;
  readonly contactEmail: string;
  readonly lines: readonly {
    readonly productName: string;
    readonly variantOptions: Readonly<Record<string, string>>;
    readonly quantity: number;
    readonly lineTotal: Money;
  }[];
  readonly totals: {
    readonly subtotal: Money;
    readonly shippingCost: Money;
    readonly discountTotal: Money;
    readonly taxTotal: Money;
    readonly grandTotal: Money;
  };
  /** `null` for an order handed over in the store (ADR-0161). */
  readonly shippingAddress: {
    readonly recipientName: string;
    readonly street: string;
    readonly exteriorNumber: string;
    readonly interiorNumber: string | null;
    readonly neighborhood: string;
    readonly postalCode: string;
    readonly municipalityName: string;
    readonly stateName: string;
  } | null;
  /** When its reservation ends, while it waits for its payment; `null` otherwise. */
  readonly paymentDueAt: Date | null;
  /** `null` for an order handed over in the store. */
  readonly deliveryMinBusinessDays: number | null;
  readonly deliveryMaxBusinessDays: number | null;
  /** The staff placed it in the physical store, with the customer there (ADR-0161). */
  readonly placedInStore: boolean;
  /** The staff hands it over in the store: it ships nowhere (ADR-0161). */
  readonly deliveredInStore: boolean;
}

/** An anonymized order: it gets no email (BR-NTF-03), and keeps nothing of its buyer to show (ADR-0067). */
export interface AnonymizedNoticeOrder {
  readonly publicCode: string;
  readonly contactEmail: null;
}

export abstract class NoticeOrders {
  /** The order for its emails; `null` when it does not exist. */
  abstract find(
    orderId: string,
  ): Promise<NoticeOrder | AnonymizedNoticeOrder | null>;
}

/** Whether the store takes payments in person (ADR-0040), from Payments, which a superadmin changes (ADR-0162). */
export abstract class InStorePayments {
  /** Asked when an email is written, so it follows a change at once. */
  abstract enabled(): Promise<boolean>;
}
