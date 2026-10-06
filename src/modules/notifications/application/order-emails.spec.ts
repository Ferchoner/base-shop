import { Money } from '../../../shared-kernel/index.js';
import type { NoticeOrder } from './notice-orders.js';
import {
  inPesos,
  orderCancelledEmail,
  orderPaidEmail,
  orderPlacedEmail,
  orderShippedEmail,
  refundCompletedEmail,
} from './order-emails.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

/** An order of 2 shirts and a cap, $399.00 with shipping. */
function order(changes: Partial<NoticeOrder> = {}): NoticeOrder {
  return {
    publicCode: 'K7M4-Q9XA',
    contactEmail: 'cliente@example.com',
    lines: [
      {
        productName: 'Camisa de lino',
        variantOptions: { talla: 'M', color: 'Azul' },
        quantity: 2,
        lineTotal: mxn(20_000),
      },
      {
        productName: 'Gorra',
        variantOptions: {},
        quantity: 1,
        lineTotal: mxn(10_000),
      },
    ],
    totals: {
      subtotal: mxn(30_000),
      shippingCost: mxn(9_900),
      discountTotal: mxn(0),
      taxTotal: mxn(5_504),
      grandTotal: mxn(39_900),
    },
    shippingAddress: {
      recipientName: 'María López',
      street: 'Av. Madero',
      exteriorNumber: '123',
      interiorNumber: null,
      neighborhood: 'Centro',
      postalCode: '58000',
      municipalityName: 'Morelia',
      stateName: 'Michoacán de Ocampo',
    },
    paymentDueAt: new Date('2026-10-02T18:20:00.000Z'),
    deliveryMinBusinessDays: 3,
    deliveryMaxBusinessDays: 7,
    placedInStore: false,
    ...changes,
  };
}

describe('Order emails (UC-NTF-01, ADR-0074, ADR-0143)', () => {
  it('writes amounts in pesos, as people in Mexico read them', () => {
    expect([inPesos(mxn(0)), inPesos(mxn(129_950))]).toEqual([
      '$0.00',
      '$1,299.50',
    ]);
  });

  it('tells the received order with its lines, totals, address, reservation, payment in the store and delivery time', () => {
    const email = orderPlacedEmail(order(), true);

    expect(email.subject).toBe('Recibimos tu pedido K7M4-Q9XA');
    expect(email.text).toBe(
      [
        'Hola:',
        '',
        'Recibimos tu pedido K7M4-Q9XA.',
        '',
        '- 2 × Camisa de lino (talla: M, color: Azul): $200.00',
        '- 1 × Gorra: $100.00',
        '',
        'Subtotal: $300.00',
        'Envío: $99.00',
        'Total: $399.00 (IVA incluido: $55.04)',
        '',
        'Lo enviaremos a:',
        'María López',
        'Av. Madero 123, Centro',
        '58000 Morelia, Michoacán de Ocampo',
        '',
        'Apartamos tus productos hasta el 2 de octubre de 2026 a las 12:20 p.m. (hora del centro de México).',
        'Para pagar, presenta el código K7M4-Q9XA en la tienda y paga $399.00.',
        'Plazo de entrega estimado: de 3 a 7 días hábiles después de confirmar tu pago.',
        '',
        'Si tienes dudas, contacta a la tienda y menciona el código K7M4-Q9XA.',
      ].join('\n'),
    );
  });

  it('says how to pay only when the store takes payments in person, and the hold only while it lasts', () => {
    const email = orderPlacedEmail(order({ paymentDueAt: null }), false);

    expect(email.text).not.toContain('Para pagar');
    expect(email.text).not.toContain('Apartamos');
    expect(email.text).toContain('Plazo de entrega estimado');
  });

  it('says neither how to pay nor the hold for an order the staff placed in the store, with the customer there (ADR-0161)', () => {
    const email = orderPlacedEmail(order({ placedInStore: true }), true);

    expect(email.text).not.toContain('Para pagar');
    expect(email.text).not.toContain('Apartamos');
    expect(email.text).toContain('Lo enviaremos a:');
    expect(email.text).toContain('Plazo de entrega estimado');
  });

  it('shows free shipping, a discount and an interior number when the order has them', () => {
    const { text } = orderPlacedEmail(
      order({
        totals: {
          subtotal: mxn(160_000),
          shippingCost: mxn(0),
          discountTotal: mxn(5_000),
          taxTotal: mxn(21_379),
          grandTotal: mxn(155_000),
        },
        shippingAddress: {
          ...order().shippingAddress,
          interiorNumber: 'B',
        },
      }),
      true,
    );

    expect(text).toContain('Envío: gratis');
    expect(text).toContain('Descuento: -$50.00');
    expect(text).toContain('Av. Madero 123, int. B, Centro');
  });

  it('quotes the address as typed on one line and without links, since a guest email is not verified (ADR-0154)', () => {
    const lineBreak = String.fromCharCode(13, 10);
    const { text } = orderPlacedEmail(
      order({
        shippingAddress: {
          ...order().shippingAddress,
          recipientName: `María${lineBreak}${lineBreak}Tu pedido fue retenido`,
          street: 'Paga en https://tienda-falsa.com',
          exteriorNumber: `123${lineBreak}www.tienda-falsa.mx`,
          interiorNumber: `B${lineBreak}Llama al 555`,
          neighborhood: `Centro${lineBreak}tienda-falsa.com`,
        },
      }),
      false,
    );

    expect(text).toContain(
      [
        'Lo enviaremos a:',
        'María Tu pedido fue retenido',
        'Paga en https: //tienda-falsa. com 123 www. tienda-falsa. mx, int. B Llama al 555, Centro tienda-falsa. com',
      ].join(String.fromCharCode(10)),
    );
    expect(text).not.toMatch(/tienda-falsa\.(com|mx)/);
  });

  it('confirms the payment with the total paid', () => {
    const email = orderPaidEmail(order());

    expect(email.subject).toBe('Pago confirmado de tu pedido K7M4-Q9XA');
    expect(email.text).toContain(
      'Confirmamos el pago de tu pedido K7M4-Q9XA por $399.00.',
    );
    expect(email.text).toContain('de 3 a 7 días hábiles');
  });

  it('tells the shipped order with its carrier and tracking number, or delivered by the store (ADR-0078)', () => {
    const byCarrier = orderShippedEmail(order(), {
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      ownDelivery: false,
    });
    const ownDelivery = orderShippedEmail(order(), {
      carrierName: null,
      trackingNumber: null,
      ownDelivery: true,
    });

    expect(byCarrier.subject).toBe('Tu pedido K7M4-Q9XA va en camino');
    expect(byCarrier.text).toContain(
      'Paquetería: Estafeta. Número de guía: EST-0001.',
    );
    expect(ownDelivery.text).toContain(
      'Lo entregará la tienda directamente en tu dirección.',
    );
    expect(ownDelivery.text).not.toContain('Paquetería');
  });

  it('tells the cancelled order, with its refund on its way when it was paid', () => {
    const paid = orderCancelledEmail(order(), true);
    const unpaid = orderCancelledEmail(order(), false);

    expect(paid.subject).toBe('Tu pedido K7M4-Q9XA fue cancelado');
    expect(paid.text).toContain(
      'El reembolso de $399.00 está en proceso; te avisaremos cuando se complete.',
    );
    expect(unpaid.text).toContain('No se hizo ningún cargo.');
    expect(unpaid.text).not.toContain('reembolso');
  });

  it('tells the completed refund with the amount refunded, not the total of the order', () => {
    const email = refundCompletedEmail(order(), mxn(19_900));

    expect(email.subject).toBe('Reembolso de tu pedido K7M4-Q9XA');
    expect(email.text).toContain(
      'Completamos el reembolso de $199.00 de tu pedido K7M4-Q9XA.',
    );
  });
});
