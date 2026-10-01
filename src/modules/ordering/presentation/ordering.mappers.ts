import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type { CheckoutQuote } from '../application/checkout.use-case.js';
import { formatPublicCode } from '../application/order-values.js';
import type {
  AdminOrderSummaryView,
  AdminOrderView,
  OrderSummaryView,
  OrderView,
} from '../application/ordering.queries.js';
import type { AdminOrderDto, AdminOrderSummaryDto } from './admin-order.dto.js';
import type { CheckoutQuoteDto } from './checkout.dto.js';
import type { OrderDto, OrderSummaryDto } from './order.dto.js';

/** `CheckoutQuote` of API_SPEC.md §8.7. */
export function toCheckoutQuoteDto(quote: CheckoutQuote): CheckoutQuoteDto {
  const { totals } = quote;
  return {
    lines: quote.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      sku: line.sku,
      productTitle: line.productTitle,
      options: { ...line.options },
      unitPrice: line.unitPrice === null ? null : toMoneyDto(line.unitPrice),
      lineTotal: line.lineTotal === null ? null : toMoneyDto(line.lineTotal),
      taxRateBp: line.taxRateBp,
      taxAmount: line.taxAmount === null ? null : toMoneyDto(line.taxAmount),
      sellable: line.sellable,
      canFulfill: line.canFulfill,
    })),
    subtotal: toMoneyDto(totals.subtotal),
    taxTotal: toMoneyDto(totals.taxTotal),
    shippingCost: toMoneyDto(totals.shippingCost),
    shippingTaxAmount: toMoneyDto(totals.shippingTaxAmount),
    discountTotal: toMoneyDto(totals.discountTotal),
    grandTotal: toMoneyDto(totals.grandTotal),
    freeShippingThreshold:
      quote.freeShippingThreshold === null
        ? null
        : toMoneyDto(quote.freeShippingThreshold),
    estimatedDelivery: {
      minBusinessDays: quote.deliveryMinBusinessDays,
      maxBusinessDays: quote.deliveryMaxBusinessDays,
    },
    readyToPlace: quote.readyToPlace,
  };
}

/** An order in a listing: `Order` without its lines nor its address (API_SPEC.md §15.4). */
export function toOrderSummaryDto(view: OrderSummaryView): OrderSummaryDto {
  const { totals } = view;
  return {
    publicCode: formatPublicCode(view.publicCode),
    status: view.status,
    contactEmail: view.contactEmail,
    itemCount: view.itemCount,
    subtotal: toMoneyDto(totals.subtotal),
    taxTotal: toMoneyDto(totals.taxTotal),
    shippingCost: toMoneyDto(totals.shippingCost),
    shippingTaxAmount: toMoneyDto(totals.shippingTaxAmount),
    discountTotal: toMoneyDto(totals.discountTotal),
    grandTotal: toMoneyDto(totals.grandTotal),
    estimatedDelivery: {
      minBusinessDays: view.deliveryMinBusinessDays,
      maxBusinessDays: view.deliveryMaxBusinessDays,
    },
    // Payments (T-190) and Shipping (T-195) do not exist yet.
    payment: null,
    shipment: null,
    placedAt: view.placedAt,
    paymentDueAt: view.paymentDueAt,
    paidAt: view.paidAt,
    shippedAt: view.shippedAt,
    deliveredAt: view.deliveredAt,
    cancelledAt: view.cancelledAt,
    expiredAt: view.expiredAt,
    refundedAt: view.refundedAt,
  };
}

/** `Order` of API_SPEC.md §8.8: never the internal number nor the ID (ADR-0049). */
export function toOrderDto(view: OrderView): OrderDto {
  return {
    ...toOrderSummaryDto(view),
    lines: view.lines.map((line) => ({
      lineNumber: line.lineNumber,
      sku: line.sku,
      productName: line.productName,
      variantOptions: { ...line.variantOptions },
      unitPrice: toMoneyDto(line.unitPrice),
      quantity: line.quantity,
      taxRateBp: line.taxRateBp,
      taxAmount: toMoneyDto(line.taxAmount),
      lineTotal: toMoneyDto(line.lineTotal),
    })),
    shippingAddress: { ...view.shippingAddress },
  };
}

/** `AdminOrder` in a listing (API_SPEC.md §15.7): both identifiers, without lines nor history. */
export function toAdminOrderSummaryDto(
  view: AdminOrderSummaryView,
): AdminOrderSummaryDto {
  return {
    ...toOrderSummaryDto(view),
    id: view.id,
    orderNumber: view.orderNumber,
    customerId: view.customerId,
    version: view.version,
    anonymizedAt: view.anonymizedAt,
    shippingAddress: { ...view.shippingAddress },
  };
}

/** `AdminOrder` of API_SPEC.md §8.9. */
export function toAdminOrderDto(view: AdminOrderView): AdminOrderDto {
  return {
    ...toAdminOrderSummaryDto(view),
    lines: toOrderDto(view).lines,
    statusHistory: view.statusHistory.map((entry) => ({ ...entry })),
  };
}
