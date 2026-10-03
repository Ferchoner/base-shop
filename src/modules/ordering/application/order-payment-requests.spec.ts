import {
  InvalidStateTransitionError,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type CustomerId,
  Order,
  type OrderId,
  type OrderStatus,
  priceLine,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';
import { OrderPaymentRequests } from './order-payment-requests.use-case.js';
import type { OrderPayments, PaymentStart } from './payment-ports.js';

// Test doubles of the unit tests of the payment requests of an order.

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const CODE = 'K7M4Q9XA' as PublicCode;
const staff = newId<'User'>();
const customer = newId<'User'>() as CustomerId;
const sourceCart = newId<'Cart'>();

/** A saved order of $198.00 in `status`, of a guest unless it has a customer. */
function saved(status: OrderStatus, owner: CustomerId | null = null): Order {
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: CODE,
    buyer:
      owner === null
        ? {
            customerId: null,
            contactEmail: 'cliente@example.com',
            privacyNoticeVersion: '2026-09',
          }
        : { customerId: owner, contactEmail: 'ana@example.com' },
    lines: [
      priceLine(
        {
          variantId: newId<'Variant'>(),
          sku: 'CAM-M',
          productName: 'Camisa',
          variantOptions: {},
          unitPrice: Money.of(9_900, 'MXN'),
          quantity: 2,
        },
        1600,
      ),
    ],
    shipping: {
      cost: Money.zero('MXN'),
      taxAmount: Money.zero('MXN'),
      taxRateBp: 1600,
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
    },
    shippingAddress: {
      recipientName: 'María',
      phone: '4431234567',
      street: 'Madero',
      exteriorNumber: '1',
      interiorNumber: null,
      neighborhood: 'Centro',
      postalCode: '58000',
      stateCode: '16',
      stateName: 'Michoacán de Ocampo',
      municipalityCode: '16053',
      municipalityName: 'Morelia',
      city: null,
      references: null,
      country: 'MX',
    },
    reservation: { id: newId<'Reservation'>(), expiresAt: PLACED },
    sourceCartId: sourceCart,
    now: PLACED,
  });
  return Order.restore({ ...placed.snapshot, status });
}

/** Orders in memory, found by ID or public code; `locked` records how. */
class InMemoryOrders extends OrderRepository {
  readonly locked: string[] = [];

  constructor(private readonly order: Order) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('Paying never places an order');
  }

  lock(id: OrderId): Promise<Order | null> {
    this.locked.push(`id ${id}`);
    return Promise.resolve(id === this.order.id ? this.order : null);
  }

  lockByPublicCode(code: PublicCode): Promise<Order | null> {
    this.locked.push(`code ${code}`);
    return Promise.resolve(code === CODE ? this.order : null);
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('Paying never looks for due orders');
  }

  lockOf(): Promise<Order[]> {
    throw new Error('Paying never anonymizes orders');
  }

  save(): Promise<void> {
    throw new Error('Paying never changes the order itself');
  }
}

function setUp(order: Order, options: { enabled?: boolean } = {}) {
  const orders = new InMemoryOrders(order);
  const calls: string[] = [];
  const enabled = options.enabled ?? true;
  const payments: OrderPayments = {
    assertManualCaptureEnabled: () => {
      calls.push('assertManualCaptureEnabled');
      if (!enabled) throw new Error('manual payments are off');
    },
    assertProviderEnabled: (provider) => {
      calls.push(`assertProviderEnabled ${provider}`);
      if (!enabled) throw new Error('provider not enabled');
    },
    start: (payable, provider) => {
      calls.push(`start ${payable.id} ${provider}`);
      return Promise.resolve({ started: true } as PaymentStart);
    },
    captureManually: (payable, input) => {
      calls.push(
        `captureManually ${payable.id} ${input.reference} ${input.note} ${input.registeredBy}`,
      );
      return Promise.resolve();
    },
    startRefund: () => {
      throw new Error('Not used to pay');
    },
    cancelPending: () => {
      throw new Error('Not used to pay');
    },
    paymentsOf: () => {
      throw new Error('Not used to pay');
    },
  };
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  return {
    requests: new OrderPaymentRequests(orders, payments, inline),
    orders,
    calls,
  };
}

describe('OrderPaymentRequests: starting a payment (UC-PAY-01)', () => {
  it('starts the payment of the pending order of the guest, with the cart it came from', async () => {
    const order = saved('PENDING_PAYMENT');
    const { requests, orders, calls } = setUp(order);

    const start = await requests.startPayment({
      publicCode: CODE,
      payer: { guestCartId: sourceCart },
      provider: 'MANUAL',
    });

    expect(start).toEqual({ started: true });
    expect(orders.locked).toEqual([`code ${CODE}`]);
    expect(calls).toEqual([
      'assertProviderEnabled MANUAL',
      `start ${order.id} MANUAL`,
    ]);
  });

  it("starts the payment of a customer's own order", async () => {
    const order = saved('PENDING_PAYMENT', customer);
    const { requests, calls } = setUp(order);

    await requests.startPayment({
      publicCode: CODE,
      payer: { customerId: customer },
      provider: 'MANUAL',
    });

    expect(calls.at(-1)).toBe(`start ${order.id} MANUAL`);
  });

  it("answers 404 for an order that does not exist or is not the payer's", async () => {
    const guestOrder = saved('PENDING_PAYMENT');
    const customerOrder = saved('PENDING_PAYMENT', customer);

    for (const [order, publicCode, payer] of [
      [guestOrder, 'ZZZZZZZZ', { guestCartId: sourceCart }],
      [guestOrder, CODE, { guestCartId: newId<'Cart'>() }],
      [guestOrder, CODE, { customerId: customer }],
      [customerOrder, CODE, { guestCartId: sourceCart }],
      [customerOrder, CODE, { customerId: newId<'User'>() }],
    ] as const) {
      const { requests, calls } = setUp(order);
      await expect(
        requests.startPayment({
          publicCode: publicCode as PublicCode,
          payer,
          provider: 'MANUAL',
        }),
      ).rejects.toThrow(NotFoundError);
      expect(calls).toEqual(['assertProviderEnabled MANUAL']);
    }
  });

  it('answers 409 for an order that is not pending', async () => {
    const { requests, calls } = setUp(saved('EXPIRED'));

    await expect(
      requests.startPayment({
        publicCode: CODE,
        payer: { guestCartId: sourceCart },
        provider: 'MANUAL',
      }),
    ).rejects.toThrow(
      new InvalidStateTransitionError('EXPIRED', 'start a payment'),
    );
    expect(calls).toEqual(['assertProviderEnabled MANUAL']);
  });

  it('checks the provider before reading the order', async () => {
    const { requests, orders } = setUp(saved('PENDING_PAYMENT'), {
      enabled: false,
    });

    await expect(
      requests.startPayment({
        publicCode: CODE,
        payer: { guestCartId: sourceCart },
        provider: 'MANUAL',
      }),
    ).rejects.toThrow('provider not enabled');
    expect(orders.locked).toEqual([]);
  });
});

describe('OrderPaymentRequests: a payment made in the store (UC-PAY-02)', () => {
  const capture = (requests: OrderPaymentRequests, orderId: OrderId) =>
    requests.captureManually({
      orderId,
      staffId: staff,
      reference: 'Ticket 00452',
      note: null,
    });

  it('captures the payment of an unpaid or expired order', async () => {
    for (const status of ['PENDING_PAYMENT', 'EXPIRED'] as const) {
      const order = saved(status);
      const { requests, calls } = setUp(order);

      await capture(requests, order.id);

      expect(calls).toEqual([
        'assertManualCaptureEnabled',
        `captureManually ${order.id} Ticket 00452 null ${staff}`,
      ]);
    }
  });

  it('answers 409 for any other status, and 404 for an order that does not exist', async () => {
    for (const status of [
      'PAID',
      'AWAITING_MANUAL_FULFILLMENT',
      'CANCELLED',
      'REFUNDED',
    ] as const) {
      const order = saved(status);
      const { requests, calls } = setUp(order);

      await expect(capture(requests, order.id)).rejects.toThrow(
        new InvalidStateTransitionError(status, 'register a manual payment'),
      );
      expect(calls).toEqual(['assertManualCaptureEnabled']);
    }
    const { requests } = setUp(saved('PENDING_PAYMENT'));
    await expect(capture(requests, newId<'Order'>())).rejects.toThrow(
      NotFoundError,
    );
  });

  it('checks that manual payments are on before reading the order', async () => {
    const order = saved('PENDING_PAYMENT');
    const { requests, orders } = setUp(order, { enabled: false });

    await expect(capture(requests, order.id)).rejects.toThrow(
      'manual payments are off',
    );
    expect(orders.locked).toEqual([]);
  });
});
