import type { Money } from '../../../shared-kernel/index.js';

// Notifications' application layer cannot import other modules (ADR-0103): this port says what the emails need of
// an order, and an adapter in its infrastructure answers it with the facade of Ordering (ADR-0143). An abstract
// class rather than an interface, so it can be the dependency injection token without depending on NestJS.

/** An order as its emails show it (ADR-0074): the public code, never the internal number (ADR-0049). */
export interface NoticeOrder {
  /** With dash. */
  readonly publicCode: string;
  /** `null` once anonymized: it gets no email (BR-NTF-03). */
  readonly contactEmail: string | null;
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
  readonly shippingAddress: {
    readonly recipientName: string;
    readonly street: string;
    readonly exteriorNumber: string;
    readonly interiorNumber: string | null;
    readonly neighborhood: string;
    readonly postalCode: string;
    readonly municipalityName: string;
    readonly stateName: string;
  };
  /** When its reservation ends, while it waits for its payment; `null` otherwise. */
  readonly paymentDueAt: Date | null;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
}

export abstract class NoticeOrders {
  /** The order for its emails; `null` when it does not exist. */
  abstract find(orderId: string): Promise<NoticeOrder | null>;
}

/** Dependency injection token of whether the store takes payments in person (`MANUAL_PAYMENTS_ENABLED`, ADR-0040). */
export const IN_STORE_PAYMENTS = Symbol('IN_STORE_PAYMENTS');
