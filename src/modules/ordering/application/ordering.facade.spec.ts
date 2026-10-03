import { Money, newId } from '../../../shared-kernel/index.js';
import type { PublicCode } from '../domain/public-code.js';
import type { OrderAnonymizations } from './order-anonymizations.use-case.js';
import { OrderingFacade } from './ordering.facade.js';
import type { OrderingQueries, OrderView } from './ordering.queries.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');
const DUE = new Date('2026-10-02T18:20:00.000Z');

function view(id: string): OrderView {
  return {
    id,
    publicCode: 'K7M4Q9XA' as PublicCode,
    status: 'PENDING_PAYMENT',
    customerId: null,
    contactEmail: 'cliente@example.com',
    totals: {
      subtotal: mxn(30_000),
      taxTotal: mxn(5_504),
      shippingCost: mxn(9_900),
      shippingTaxAmount: mxn(1_366),
      discountTotal: mxn(0),
      grandTotal: mxn(39_900),
    },
    itemCount: 3,
    deliveryMinBusinessDays: 3,
    deliveryMaxBusinessDays: 7,
    placedAt: DUE,
    paymentDueAt: DUE,
    paidAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    lines: [
      {
        id: newId(),
        lineNumber: 1,
        sku: 'CAM-M',
        productName: 'Camisa de lino',
        variantOptions: { talla: 'M' },
        unitPrice: mxn(10_000),
        quantity: 3,
        taxRateBp: 1600,
        taxAmount: mxn(4_138),
        lineTotal: mxn(30_000),
      },
    ],
    shippingAddress: {
      recipientName: 'María López',
      phone: '4431234567',
      street: 'Av. Madero',
      exteriorNumber: '123',
      interiorNumber: 'B',
      neighborhood: 'Centro',
      postalCode: '58000',
      stateCode: '16',
      stateName: 'Michoacán de Ocampo',
      municipalityCode: '16053',
      municipalityName: 'Morelia',
      city: 'Morelia',
      references: 'Frente a la catedral',
      country: 'MX',
    },
  } as unknown as OrderView;
}

function facade(order: OrderView | null) {
  const asked: string[] = [];
  const queries = {
    findAdminOrder: (id: string) => {
      asked.push(id);
      return Promise.resolve(order);
    },
  } as unknown as OrderingQueries;
  return {
    facade: new OrderingFacade(queries, {} as OrderAnonymizations),
    asked,
  };
}

describe('OrderingFacade (ADR-0074, ADR-0143)', () => {
  it('reads an order for its emails, with the public code as people see it and the address without the phone', async () => {
    const id = newId();
    const { facade: ordering, asked } = facade(view(id));

    const notice = await ordering.orderNotice(id.toUpperCase());

    expect(asked).toEqual([id]);
    expect(notice).toEqual({
      orderId: id,
      publicCode: 'K7M4-Q9XA',
      contactEmail: 'cliente@example.com',
      lines: [
        {
          productName: 'Camisa de lino',
          variantOptions: { talla: 'M' },
          quantity: 3,
          lineTotal: mxn(30_000),
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
        interiorNumber: 'B',
        neighborhood: 'Centro',
        postalCode: '58000',
        city: 'Morelia',
        municipalityName: 'Morelia',
        stateName: 'Michoacán de Ocampo',
      },
      paymentDueAt: DUE,
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
    });
  });

  it('answers null for an order that does not exist', async () => {
    expect(await facade(null).facade.orderNotice(newId())).toBeNull();
  });
});
