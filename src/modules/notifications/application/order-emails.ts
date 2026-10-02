import { inMexicoTime, type Money } from '../../../shared-kernel/index.js';
import type { NoticeOrder } from './notice-orders.js';

/** What an email says, before it knows whom to: its subject and its plain text (ADR-0110). */
export interface OrderEmail {
  readonly subject: string;
  readonly text: string;
}

/** How a shipment left: by a carrier, with its tracking number, or delivered by the store (ADR-0078). */
export interface ShipmentLeft {
  readonly carrierName: string | null;
  readonly trackingNumber: string | null;
  readonly ownDelivery: boolean;
}

// The emails of the life of an order (ADR-0074, ADR-0143): in Spanish, plain text, transactional, with the public
// code only and no payment data, tokens nor links (ADR-0077).

const PESOS = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

/** `$1,299.00`. */
export function inPesos(money: Money): string {
  return PESOS.format(money.amount / 100);
}

function email(
  subject: string,
  order: NoticeOrder,
  body: readonly string[],
): OrderEmail {
  return {
    subject,
    text: [
      'Hola:',
      '',
      ...body,
      '',
      `Si tienes dudas, contacta a la tienda y menciona el código ${order.publicCode}.`,
    ].join('\n'),
  };
}

function deliveryTime(order: NoticeOrder): string {
  return `Plazo de entrega estimado: de ${order.deliveryMinBusinessDays} a ${order.deliveryMaxBusinessDays} días hábiles después de confirmar tu pago.`;
}

function lineOf(line: NoticeOrder['lines'][number]): string {
  const options = Object.entries(line.variantOptions)
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
  return `- ${line.quantity} × ${line.productName}${options === '' ? '' : ` (${options})`}: ${inPesos(line.lineTotal)}`;
}

/**
 * The received order (`OrderPlaced`): its lines, totals and shipping address, how long its products are held and
 * the estimated delivery time (ADR-0083). With payments in the store, how to pay (ADR-0055, ADR-0143).
 */
export function orderPlacedEmail(
  order: NoticeOrder,
  inStorePayments: boolean,
): OrderEmail {
  const { totals, shippingAddress: address } = order;
  const shipping =
    totals.shippingCost.amount === 0 ? 'gratis' : inPesos(totals.shippingCost);
  const interior =
    address.interiorNumber === null ? '' : `, int. ${address.interiorNumber}`;
  return email(`Recibimos tu pedido ${order.publicCode}`, order, [
    `Recibimos tu pedido ${order.publicCode}.`,
    '',
    ...order.lines.map(lineOf),
    '',
    `Subtotal: ${inPesos(totals.subtotal)}`,
    `Envío: ${shipping}`,
    ...(totals.discountTotal.amount === 0
      ? []
      : [`Descuento: -${inPesos(totals.discountTotal)}`]),
    `Total: ${inPesos(totals.grandTotal)} (IVA incluido: ${inPesos(totals.taxTotal)})`,
    '',
    'Lo enviaremos a:',
    address.recipientName,
    `${address.street} ${address.exteriorNumber}${interior}, ${address.neighborhood}`,
    `${address.postalCode} ${address.municipalityName}, ${address.stateName}`,
    '',
    ...(order.paymentDueAt === null
      ? []
      : [
          `Apartamos tus productos hasta el ${inMexicoTime(order.paymentDueAt)} (hora del centro de México).`,
        ]),
    ...(inStorePayments
      ? [
          `Para pagar, presenta el código ${order.publicCode} en la tienda y paga ${inPesos(totals.grandTotal)}.`,
        ]
      : []),
    deliveryTime(order),
  ]);
}

/** The confirmed payment (`OrderPaid`): the total paid. */
export function orderPaidEmail(order: NoticeOrder): OrderEmail {
  return email(`Pago confirmado de tu pedido ${order.publicCode}`, order, [
    `Confirmamos el pago de tu pedido ${order.publicCode} por ${inPesos(order.totals.grandTotal)}.`,
    '',
    'Te avisaremos cuando vaya en camino.',
    deliveryTime(order),
  ]);
}

/** The shipped order (`ShipmentDispatched`): the carrier and tracking number, or the store's own delivery. */
export function orderShippedEmail(
  order: NoticeOrder,
  shipment: ShipmentLeft,
): OrderEmail {
  return email(`Tu pedido ${order.publicCode} va en camino`, order, [
    `Tu pedido ${order.publicCode} ya va en camino.`,
    '',
    shipment.ownDelivery
      ? 'Lo entregará la tienda directamente en tu dirección.'
      : `Paquetería: ${shipment.carrierName}. Número de guía: ${shipment.trackingNumber}.`,
  ]);
}

/** The cancelled order (`OrderCancelled`): whether its refund is on its way. */
export function orderCancelledEmail(
  order: NoticeOrder,
  refundStarted: boolean,
): OrderEmail {
  return email(`Tu pedido ${order.publicCode} fue cancelado`, order, [
    `Cancelamos tu pedido ${order.publicCode}.`,
    '',
    refundStarted
      ? `El reembolso de ${inPesos(order.totals.grandTotal)} está en proceso; te avisaremos cuando se complete.`
      : 'No se hizo ningún cargo.',
  ]);
}

/** The completed refund (`RefundCompleted`): the amount refunded. */
export function refundCompletedEmail(
  order: NoticeOrder,
  amount: Money,
): OrderEmail {
  return email(`Reembolso de tu pedido ${order.publicCode}`, order, [
    `Completamos el reembolso de ${inPesos(amount)} de tu pedido ${order.publicCode}.`,
  ]);
}
