import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailSender,
  Money,
} from '../../../shared-kernel/index.js';
import {
  type AnonymizedNoticeOrder,
  type NoticeOrder,
  NoticeOrders,
} from './notice-orders.js';
import { OrderNotices } from './order-notices.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

const ORDER: NoticeOrder = {
  publicCode: 'K7M4-Q9XA',
  contactEmail: 'cliente@example.com',
  lines: [
    {
      productName: 'Camisa de lino',
      variantOptions: {},
      quantity: 1,
      lineTotal: mxn(10_000),
    },
  ],
  totals: {
    subtotal: mxn(10_000),
    shippingCost: mxn(9_900),
    discountTotal: mxn(0),
    taxTotal: mxn(2_745),
    grandTotal: mxn(19_900),
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
  paymentDueAt: null,
  deliveryMinBusinessDays: 3,
  deliveryMaxBusinessDays: 7,
  placedInStore: false,
  deliveredInStore: false,
};

type SomeOrder = NoticeOrder | AnonymizedNoticeOrder;

class SomeOrders extends NoticeOrders {
  constructor(private readonly orders: Record<string, SomeOrder>) {
    super();
  }

  find(orderId: string): Promise<SomeOrder | null> {
    return Promise.resolve(this.orders[orderId] ?? null);
  }
}

function setUp(
  orders: Record<string, SomeOrder> = { order: ORDER },
  options: { inStore?: boolean; failing?: boolean } = {},
) {
  const sent: EmailMessage[] = [];
  const email = {
    send: (message: EmailMessage) => {
      if (options.failing === true) {
        return Promise.reject(new EmailDeliveryError('connection refused'));
      }
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as EmailSender;
  const inStorePayments = { enabled: options.inStore ?? true, asked: 0 };
  return {
    notices: new OrderNotices(new SomeOrders(orders), email, {
      enabled: () => {
        inStorePayments.asked += 1;
        return Promise.resolve(inStorePayments.enabled);
      },
    }),
    sent,
    inStorePayments,
  };
}

describe('OrderNotices (UC-NTF-01, BR-NTF-01 to 04, ADR-0143)', () => {
  let warn: jest.SpiedFunction<Logger['warn']>;
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emails each change to the contact email of the order', async () => {
    const { notices, sent } = setUp();

    await notices.orderPlaced('order');
    await notices.orderPaid('order');
    await notices.orderShipped('order', {
      carrierName: null,
      trackingNumber: null,
      ownDelivery: true,
    });
    await notices.orderCancelled('order', true);
    await notices.refundCompleted('order', mxn(19_900));

    expect(sent.map(({ to, subject }) => [to, subject])).toEqual([
      ['cliente@example.com', 'Recibimos tu pedido K7M4-Q9XA'],
      ['cliente@example.com', 'Pago confirmado de tu pedido K7M4-Q9XA'],
      ['cliente@example.com', 'Tu pedido K7M4-Q9XA va en camino'],
      ['cliente@example.com', 'Tu pedido K7M4-Q9XA fue cancelado'],
      ['cliente@example.com', 'Reembolso de tu pedido K7M4-Q9XA'],
    ]);
    expect(sent[2].text).toContain('Lo entregará la tienda');
    expect(sent[3].text).toContain('está en proceso');
    expect(sent[4].text).toContain('$199.00');
    expect([warn, error].map((spy) => spy.mock.calls)).toEqual([[], []]);
  });

  it('says how to pay in the store only when the store takes payments in person', async () => {
    const inStore = setUp(undefined, { inStore: true });
    const online = setUp(undefined, { inStore: false });

    await inStore.notices.orderPlaced('order');
    await online.notices.orderPlaced('order');

    expect(inStore.sent[0].text).toContain('Para pagar');
    expect(online.sent[0].text).not.toContain('Para pagar');
  });

  it('asks Payments as it writes each email of a placed order, so a change by a superadmin counts at once (ADR-0162)', async () => {
    const { notices, sent, inStorePayments } = setUp();

    await notices.orderPlaced('order');
    inStorePayments.enabled = false;
    await notices.orderPlaced('order');
    await notices.orderPaid('order');
    await notices.orderPlaced('missing');

    expect(sent.map(({ text }) => text.includes('Para pagar'))).toEqual([
      true,
      false,
      false,
    ]);
    expect(inStorePayments.asked).toBe(2);
  });

  it('emails no anonymized order (BR-NTF-03)', async () => {
    const { notices, sent } = setUp({
      order: { publicCode: ORDER.publicCode, contactEmail: null },
    });

    await notices.orderCancelled('order', false);

    expect(sent).toEqual([]);
    expect([warn, error].map((spy) => spy.mock.calls)).toEqual([[], []]);
  });

  it('logs an order that does not exist, emailing nothing', async () => {
    const { notices, sent } = setUp();

    await notices.orderPaid('missing');

    expect(sent).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      'Email order-paid was not sent: order missing does not exist',
    );
  });

  it('lets an email the server did not take fail, without the recipient, so the delivery of the event retries it (BR-NTF-04, ADR-0150)', async () => {
    const { notices } = setUp(undefined, { failing: true });

    const sending = notices.orderPlaced('order');

    await expect(sending).rejects.toThrow(EmailDeliveryError);
    await expect(sending).rejects.toThrow('connection refused');
    expect(warn).not.toHaveBeenCalled();
  });
});
