import type { PostalAddressDto } from '../../../platform/http/address.dto.js';
import { toMoneyDto } from '../../../platform/http/money.dto.js';
import type { BlockedOrderDataView } from '../application/blocked-order-data.js';
import type { CheckoutQuote } from '../application/checkout.use-case.js';
import type { OrderAccess } from '../application/order-access-links.js';
import type { WithPaymentAndShipment } from '../application/order-reader.js';
import {
  formatPublicCode,
  type PublicCode,
} from '../application/order-values.js';
import type {
  AdminOrderSummaryView,
  AdminOrderView,
  OrderLineView,
  OrderSummaryView,
  OrderView,
} from '../application/ordering.queries.js';
import type {
  OrderPayment,
  PaymentStart,
} from '../application/payment-ports.js';
import type {
  AdminOrderDto,
  AdminOrderSummaryDto,
  BlockedOrderDataDto,
} from './admin-order.dto.js';
import type { CheckoutQuoteDto } from './checkout.dto.js';
import type {
  AdminOrderPaymentDto,
  AdminOrderShipmentDto,
  OrderAccessDto,
  OrderDto,
  OrderFieldsDto,
  OrderLineDto,
  OrderShipmentDto,
  OrderSummaryDto,
} from './order.dto.js';
import type { PaymentStartDto } from './payment.dto.js';
import type { CartCopy } from '../application/reorder-ports.js';
import type { OrderShipment } from '../application/shipment-ports.js';
import type { ReorderDto } from './order.dto.js';

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

/** What every view of an order shares; each adds its own `payment` and `shipment`. */
function toOrderFields(view: OrderSummaryView): OrderFieldsDto {
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

/** An order in a listing: `Order` without its lines nor its address (API_SPEC.md §15.4). */
export function toOrderSummaryDto(
  view: WithPaymentAndShipment<OrderSummaryView>,
): OrderSummaryDto {
  return {
    ...toOrderFields(view),
    payment:
      view.payment === null
        ? null
        : { provider: view.payment.provider, status: view.payment.status },
    shipment: view.shipment === null ? null : toOrderShipmentDto(view.shipment),
  };
}

/** What an access link opens (API_SPEC.md §15.6): the summaries of the guest orders of its email. */
export function toOrderAccessDto(access: OrderAccess): OrderAccessDto {
  return {
    contactEmail: access.contactEmail,
    orders: access.orders.map(toOrderSummaryDto),
  };
}

/** `Order` of API_SPEC.md §8.8: never the internal number nor the ID (ADR-0049). */
export function toOrderDto(view: WithPaymentAndShipment<OrderView>): OrderDto {
  return {
    ...toOrderSummaryDto(view),
    lines: view.lines.map(toLineDto),
    shippingAddress: { ...view.shippingAddress },
  };
}

/** `AdminOrder` in a listing (API_SPEC.md §15.7): both identifiers, without lines nor history. */
export function toAdminOrderSummaryDto(
  view: WithPaymentAndShipment<AdminOrderSummaryView>,
): AdminOrderSummaryDto {
  return {
    ...toOrderFields(view),
    payment:
      view.payment === null ? null : toAdminOrderPaymentDto(view.payment),
    shipment:
      view.shipment === null ? null : toAdminOrderShipmentDto(view.shipment),
    id: view.id,
    orderNumber: view.orderNumber,
    customerId: view.customerId,
    version: view.version,
    anonymizedAt: view.anonymizedAt,
    blockedAt: view.blockedAt,
    shippingAddress: { ...view.shippingAddress },
  };
}

/** The personal data of a blocked order (API_SPEC.md §15.7), whole: a blocked order was not anonymized. */
export function toBlockedOrderDataDto(
  view: BlockedOrderDataView,
): BlockedOrderDataDto {
  return {
    contactEmail: view.contactEmail,
    shippingAddress: { ...view.shippingAddress } as PostalAddressDto,
    shipmentDestination:
      view.shipmentDestination === null
        ? null
        : ({ ...view.shipmentDestination } as PostalAddressDto),
  };
}

/** `AdminOrder` of API_SPEC.md §8.9. */
export function toAdminOrderDto(
  view: WithPaymentAndShipment<AdminOrderView>,
): AdminOrderDto {
  return {
    ...toAdminOrderSummaryDto(view),
    lines: view.lines.map((line) => ({ id: line.id, ...toLineDto(line) })),
    statusHistory: view.statusHistory.map((entry) => ({ ...entry })),
  };
}

/** The response of starting a payment (API_SPEC.md §16.2), with the public code as people see it. */
export function toPaymentStartDto(start: PaymentStart): PaymentStartDto {
  return {
    paymentId: start.payment.id,
    provider: start.payment.provider,
    status: start.payment.status,
    amount: toMoneyDto(start.payment.amount),
    action: {
      type: start.action.type,
      orderCode: formatPublicCode(start.action.orderCode as PublicCode),
      amount: toMoneyDto(start.action.amount),
      instructions: start.action.instructions,
    },
  };
}

function toOrderShipmentDto(shipment: OrderShipment): OrderShipmentDto {
  return {
    status: shipment.status,
    carrierName: shipment.carrierName,
    trackingNumber: shipment.trackingNumber,
    ownDelivery: shipment.ownDelivery,
    dispatchedAt: shipment.dispatchedAt,
    deliveredAt: shipment.deliveredAt,
  };
}

function toAdminOrderShipmentDto(
  shipment: OrderShipment,
): AdminOrderShipmentDto {
  return {
    id: shipment.id,
    ...toOrderShipmentDto(shipment),
    version: shipment.version,
  };
}

function toAdminOrderPaymentDto(payment: OrderPayment): AdminOrderPaymentDto {
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amount: toMoneyDto(payment.amount),
    capturedAmount: toMoneyDto(payment.capturedAmount),
    refundedAmount: toMoneyDto(payment.refundedAmount),
    capturedAt: payment.capturedAt,
    refunds: payment.refunds.map((refund) => ({
      ...refund,
      amount: toMoneyDto(refund.amount),
    })),
  };
}

/** A line as the customer sees it: never its ID. */
function toLineDto(line: OrderLineView): OrderLineDto {
  return {
    lineNumber: line.lineNumber,
    sku: line.sku,
    productName: line.productName,
    variantOptions: { ...line.variantOptions },
    unitPrice: toMoneyDto(line.unitPrice),
    quantity: line.quantity,
    taxRateBp: line.taxRateBp,
    taxAmount: toMoneyDto(line.taxAmount),
    lineTotal: toMoneyDto(line.lineTotal),
  };
}

export function toReorderDto(copy: CartCopy): ReorderDto {
  return {
    cartId: copy.cartId,
    skippedVariantIds: [...copy.skippedVariantIds],
  };
}
