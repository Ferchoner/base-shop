import { Injectable } from '@nestjs/common';
import { type Money, toId } from '../../../shared-kernel/index.js';
import type { OrderStatus } from '../domain/order.js';
import { formatPublicCode } from '../domain/public-code.js';
import {
  type AnonymizedBuyer,
  OrderAnonymizations,
} from './order-anonymizations.use-case.js';
import { OrderingQueries } from './ordering.queries.js';

/** A line of an order, as its emails show it. */
export interface OrderNoticeLine {
  readonly productName: string;
  readonly variantOptions: Readonly<Record<string, string>>;
  readonly quantity: number;
  readonly lineTotal: Money;
}

/**
 * An order as the emails to its buyer show it (ADR-0074, ADR-0143): its public code, never the internal number
 * (ADR-0049), and the shipping address without the phone.
 */
export interface OrderNotice {
  readonly orderId: string;
  /** With dash, as people see it. */
  readonly publicCode: string;
  readonly contactEmail: string;
  readonly lines: readonly OrderNoticeLine[];
  readonly totals: {
    readonly subtotal: Money;
    readonly shippingCost: Money;
    readonly discountTotal: Money;
    readonly taxTotal: Money;
    readonly grandTotal: Money;
  };
  /** The name of the promotion of its discount, as the customer saw it; `null` without one (ADR-0168). */
  readonly promotionName: string | null;
  /** `null` for an order handed over in the store (ADR-0161). */
  readonly shippingAddress: {
    readonly recipientName: string;
    readonly street: string;
    readonly exteriorNumber: string;
    readonly interiorNumber: string | null;
    readonly neighborhood: string;
    readonly postalCode: string;
    readonly city: string | null;
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
  /** The staff hands it over in the store, where it is paid: it ships nowhere (ADR-0161). */
  readonly deliveredInStore: boolean;
}

/** An anonymized order (ADR-0067): it gets no email, and keeps nothing of its buyer to show. */
export interface AnonymizedOrderNotice {
  readonly orderId: string;
  /** With dash, as people see it. */
  readonly publicCode: string;
  readonly contactEmail: null;
}

/**
 * Whether the store has the money of a sale: `PAID` once it was paid and while it is fulfilled, shipped or delivered;
 * `PENDING` while it waits for its payment; `NONE` when it expired, was cancelled or was refunded.
 */
export type StoreSalePayment = 'PAID' | 'PENDING' | 'NONE';

/** A sale of the physical store (ADR-0161), as a work order shows the ones that pay for it (ADR-0167). */
export interface StoreSale {
  readonly orderId: string;
  /** With dash, as people see it. */
  readonly publicCode: string;
  /** The internal number, for the staff (ADR-0049). */
  readonly orderNumber: number;
  readonly status: OrderStatus;
  readonly grandTotal: Money;
  readonly placedAt: Date;
  readonly paidAt: Date | null;
  readonly payment: StoreSalePayment;
}

const PAID_STATUSES: readonly OrderStatus[] = [
  'PAID',
  'AWAITING_MANUAL_FULFILLMENT',
  'SHIPPED',
  'DELIVERED',
];

/**
 * Public API of Ordering (ADR-0005): for the emails of Notifications, which reacts to the events of the order, its
 * payment and its shipment and reads the order here (ADR-0143), for the anonymizations of Privacy (ADR-0145) and for
 * the sales that pay for a work order (ADR-0167). Ordering never uses any of them.
 */
@Injectable()
export class OrderingFacade {
  constructor(
    private readonly queries: OrderingQueries,
    private readonly anonymizations: OrderAnonymizations,
  ) {}

  /**
   * Anonymizes the orders of a buyer and their shipments (UC-IAM-19, ADR-0067), all or none, in the transaction of
   * the caller. Each order must have concluded (ADR-0070, ADR-0145).
   *
   * @returns how many orders it anonymized.
   * @throws NotFoundError for a guest when no guest order has the code and the email, the same as the lookup
   *   (BR-ORD-11); ActiveOrdersExistError when an order has not concluded (E-31).
   */
  anonymizeOrders(input: {
    buyer: AnonymizedBuyer;
    reason: string;
    at: Date;
  }): Promise<number> {
    return this.anonymizations.anonymize(input);
  }

  /**
   * Whether the customer has an order that has not concluded (ADR-0152), which keeps an inactive customer from being
   * anonymized; in the transaction of the caller.
   */
  hasOpenOrders(customerId: string): Promise<boolean> {
    return this.queries.hasOpenOrders(toId<'User'>(customerId));
  }

  /**
   * The sales of the physical store among these orders (ADR-0167), oldest first; online orders and unknown IDs are
   * left out.
   */
  async storeSales(orderIds: readonly string[]): Promise<StoreSale[]> {
    if (orderIds.length === 0) return [];
    const views = await this.queries.storeOrders(
      orderIds.map((id) => toId<'Order'>(id)),
    );
    return views.map((view) => ({
      orderId: view.id,
      publicCode: formatPublicCode(view.publicCode),
      orderNumber: view.orderNumber,
      status: view.status,
      grandTotal: view.totals.grandTotal,
      placedAt: view.placedAt,
      paidAt: view.paidAt,
      payment: PAID_STATUSES.includes(view.status)
        ? 'PAID'
        : view.status === 'PENDING_PAYMENT'
          ? 'PENDING'
          : 'NONE',
    }));
  }

  /** The order for its emails; `null` when it does not exist. */
  async orderNotice(
    orderId: string,
  ): Promise<OrderNotice | AnonymizedOrderNotice | null> {
    const view = await this.queries.findAdminOrder(toId<'Order'>(orderId));
    if (view === null) return null;
    const { contactEmail, totals, shippingAddress: address } = view;
    const publicCode = formatPublicCode(view.publicCode);
    // Both go with the anonymization (ADR-0067); a sale in the store whose buyer gave no email gets none either.
    if (
      contactEmail === null ||
      (address !== null && address.recipientName === null)
    ) {
      return { orderId: view.id, publicCode, contactEmail: null };
    }
    return {
      orderId: view.id,
      publicCode,
      contactEmail,
      lines: view.lines.map((line) => ({
        productName: line.productName,
        variantOptions: { ...line.variantOptions },
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      })),
      totals: {
        subtotal: totals.subtotal,
        shippingCost: totals.shippingCost,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
      },
      promotionName: view.promotion?.name ?? null,
      shippingAddress:
        address === null
          ? null
          : {
              recipientName: address.recipientName,
              street: address.street,
              exteriorNumber: address.exteriorNumber,
              interiorNumber: address.interiorNumber,
              neighborhood: address.neighborhood,
              postalCode: address.postalCode,
              city: address.city,
              municipalityName: address.municipalityName,
              stateName: address.stateName,
            },
      paymentDueAt: view.paymentDueAt,
      deliveryMinBusinessDays: view.deliveryMinBusinessDays,
      deliveryMaxBusinessDays: view.deliveryMaxBusinessDays,
      placedInStore: view.channel === 'STORE',
      deliveredInStore: view.fulfillment === 'IN_STORE',
    };
  }
}
