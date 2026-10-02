import {
  type AuditEntry,
  type AuditTrail,
  InvalidStateTransitionError,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  Order,
  type OrderId,
  type OrderStatus,
  priceLine,
  type ReservationId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { RestockNotAllowedError } from '../domain/ordering-errors.js';
import type { PublicCode } from '../domain/public-code.js';
import type { OrderStock, StockLine } from './checkout-ports.js';
import type { OrderPayments } from './payment-ports.js';
import type { OrderShipments } from './shipment-ports.js';
import { OrderLifecycle } from './order-lifecycle.use-case.js';

// Test doubles of the unit tests of the life of an order.

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const NOW = new Date('2026-10-01T13:00:00.000Z');
const CAPTURED = new Date('2026-10-01T12:30:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');
const staff = newId<'User'>();
const [shirt, cap] = [newId<'Variant'>(), newId<'Variant'>()];

/** A saved order of 2 shirts and a cap, $498.00 with shipping, in `status` at version 3. */
function saved(status: OrderStatus, paidAt: Date | null = null): Order {
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: 'K7M4Q9XA' as PublicCode,
    buyer: {
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
    },
    lines: [
      priceLine(
        {
          variantId: shirt,
          sku: 'CAM-M',
          productName: 'Camisa',
          variantOptions: {},
          unitPrice: mxn(10_000),
          quantity: 2,
        },
        1600,
      ),
      priceLine(
        {
          variantId: cap,
          sku: 'GOR-U',
          productName: 'Gorra',
          variantOptions: {},
          unitPrice: mxn(19_900),
          quantity: 1,
        },
        1600,
      ),
    ],
    shipping: {
      cost: mxn(9_900),
      taxAmount: mxn(1_366),
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
    sourceCartId: newId<'Cart'>(),
    now: PLACED,
  });
  return Order.restore({ ...placed.snapshot, status, paidAt, version: 3 });
}

/** Orders in memory: `lock` hands a fresh copy, and `saved` keeps what was saved. */
class InMemoryOrders extends OrderRepository {
  readonly saved: Order[] = [];
  private readonly orders = new Map<OrderId, Order>();

  constructor(...orders: Order[]) {
    super();
    for (const order of orders) this.orders.set(order.id, order);
  }

  insert(): Promise<boolean> {
    throw new Error('The life of an order never places one');
  }

  lock(id: OrderId): Promise<Order | null> {
    const order = this.orders.get(id);
    return Promise.resolve(
      order === undefined ? null : Order.restore(order.snapshot),
    );
  }

  lockByPublicCode(): Promise<Order | null> {
    throw new Error('The life of an order finds it by its ID');
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('The life of an order never looks for due orders');
  }

  save(order: Order, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.saved.push(order);
    return Promise.resolve();
  }
}

/** Inventory in memory: `calls` records, in order, what the order asked. */
function fakeStock(
  options: {
    commit?: 'committed' | 'already-committed' | 'not-active';
    available?: boolean;
    /** The shipment of the order was dispatched, though the order is not SHIPPED yet. */
    shipmentLeft?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const reservation = newId<'Reservation'>() as ReservationId;
  const stock: OrderStock = {
    canFulfill: () => {
      throw new Error('Not used by the life of an order');
    },
    reserve: (_orderId, lines: readonly StockLine[]) => {
      calls.push(`reserve ${lines.map((l) => l.quantity).join(',')}`);
      if (options.available === false) {
        return Promise.reject(new Error('insufficient stock'));
      }
      return Promise.resolve({ id: reservation, expiresAt: NOW });
    },
    reserveIfAvailable: (_orderId, lines: readonly StockLine[]) => {
      calls.push(
        `reserveIfAvailable ${lines.map((l) => l.quantity).join(',')}`,
      );
      return Promise.resolve(
        options.available === false
          ? null
          : { id: reservation, expiresAt: NOW },
      );
    },
    commit: () => {
      calls.push('commit');
      // A reservation opened again for a late payment is always active.
      const outcome = calls.some((call) => call.startsWith('reserve'))
        ? 'committed'
        : (options.commit ?? 'committed');
      return Promise.resolve(outcome);
    },
    release: () => {
      calls.push('release');
      return Promise.resolve(true);
    },
    expire: () => {
      throw new Error('The life of an order never expires a reservation');
    },
    restock: ({ reasonCode, lines }) => {
      calls.push(
        `restock ${reasonCode} ${lines.map((l) => `${l.quantity}/${l.sold}`).join(',')}`,
      );
      return Promise.resolve([]);
    },
  };
  return { stock, calls, reservation };
}

function setUp(order: Order, options: Parameters<typeof fakeStock>[0] = {}) {
  const orders = new InMemoryOrders(order);
  const { stock, calls, reservation } = fakeStock(options);
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const payments = {
    startRefund: () => {
      calls.push('startRefund');
      return Promise.resolve();
    },
    cancelPending: () => {
      calls.push('cancelPending');
      return Promise.resolve();
    },
  } as unknown as OrderPayments;
  const shipments = {
    createFor: () => {
      calls.push('createShipment');
      return Promise.resolve();
    },
    cancel: () => {
      calls.push('cancelShipment');
      return options.shipmentLeft === true
        ? Promise.reject(
            new InvalidStateTransitionError('DISPATCHED', 'cancel'),
          )
        : Promise.resolve();
    },
  } as unknown as OrderShipments;
  const lifecycle = new OrderLifecycle(
    orders,
    stock,
    payments,
    shipments,
    inline,
    audit,
    { now: () => NOW },
  );
  return { lifecycle, orders, calls, audited, reservation };
}

const savedOne = (orders: InMemoryOrders) => {
  expect(orders.saved).toHaveLength(1);
  return orders.saved[0];
};

describe('OrderLifecycle: cancelling (UC-ORD-07)', () => {
  const cancel = (
    lifecycle: OrderLifecycle,
    order: Order,
    changes: { restock?: boolean; version?: number } = {},
  ) =>
    lifecycle.cancel({
      orderId: order.id,
      actorId: staff,
      reason: 'Duplicado',
      restock: changes.restock ?? false,
      version: changes.version ?? 3,
    });

  it('cancels an unpaid order, releases its stock and audits who and why', async () => {
    const order = saved('PENDING_PAYMENT');
    const { lifecycle, orders, calls, audited } = setUp(order);

    await cancel(lifecycle, order);

    expect(savedOne(orders).snapshot).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: NOW,
    });
    expect(savedOne(orders).statusChanges[0]).toMatchObject({
      actorId: staff,
      reason: 'Duplicado',
    });
    expect(calls).toEqual(['release', 'cancelPending']);
    expect(audited).toEqual([
      {
        action: 'orders.cancel',
        resource: { type: 'order', id: order.id },
        changes: { status: { from: 'PENDING_PAYMENT', to: 'CANCELLED' } },
        reason: 'Duplicado',
      },
    ]);
  });

  it('rejects an outdated version, a restock of an unpaid order and an order that cannot be cancelled, changing nothing', async () => {
    const pending = saved('PENDING_PAYMENT');
    const shipped = saved('SHIPPED', CAPTURED);
    const first = setUp(pending);
    const second = setUp(pending);
    const third = setUp(shipped);

    await expect(
      cancel(first.lifecycle, pending, { version: 2 }),
    ).rejects.toThrow(new VersionConflictError(3));
    await expect(
      cancel(second.lifecycle, pending, { restock: true }),
    ).rejects.toThrow(RestockNotAllowedError.notPaid('PENDING_PAYMENT'));
    await expect(cancel(third.lifecycle, shipped)).rejects.toThrow(
      new InvalidStateTransitionError('SHIPPED', 'cancel'),
    );
    for (const { orders, calls, audited } of [first, second, third]) {
      expect([orders.saved, calls, audited]).toEqual([[], [], []]);
    }
  });

  it('cancels a paid order and starts its refund in the same operation, without touching the stock (UC-PAY-03)', async () => {
    for (const status of ['PAID', 'AWAITING_MANUAL_FULFILLMENT'] as const) {
      const order = saved(status, CAPTURED);
      const { lifecycle, orders, calls, audited } = setUp(order);

      await cancel(lifecycle, order);

      expect(calls).toEqual(['cancelShipment', 'startRefund']);
      expect(savedOne(orders).snapshot).toMatchObject({
        status: 'CANCELLED',
        paidAt: CAPTURED,
      });
      expect(audited[0].changes).toEqual({
        status: { from: status, to: 'CANCELLED' },
      });
    }
  });

  it('cancels nothing when the shipment of a paid order left, though the order is not SHIPPED yet (ADR-0140)', async () => {
    const order = saved('PAID', CAPTURED);
    const { lifecycle, orders, calls, audited } = setUp(order, {
      shipmentLeft: true,
    });

    await expect(cancel(lifecycle, order)).rejects.toThrow(
      new InvalidStateTransitionError('DISPATCHED', 'cancel'),
    );
    expect([orders.saved, audited, calls]).toEqual([
      [],
      [],
      ['cancelShipment'],
    ]);
  });

  it('cancels a paid order and restocks every line in full in the same operation (ADR-0142)', async () => {
    const order = saved('PAID', CAPTURED);
    const { lifecycle, calls } = setUp(order);

    await cancel(lifecycle, order, { restock: true });

    expect(calls).toEqual([
      'cancelShipment',
      'startRefund',
      `restock ORDER_CANCELLED ${order.snapshot.lines.map((l) => `${l.quantity}/${l.quantity}`).join(',')}`,
    ]);
  });

  it('answers 404 for an order that does not exist', async () => {
    const { lifecycle } = setUp(saved('PENDING_PAYMENT'));

    await expect(
      lifecycle.cancel({
        orderId: newId<'Order'>(),
        actorId: staff,
        reason: 'Duplicado',
        restock: false,
        version: 1,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('OrderLifecycle: retrying the fulfillment (UC-ORD-08)', () => {
  it('reserves and confirms every line again, and the order is paid', async () => {
    const order = saved('AWAITING_MANUAL_FULFILLMENT', CAPTURED);
    const { lifecycle, orders, calls, audited, reservation } = setUp(order);

    await lifecycle.retryFulfillment({
      orderId: order.id,
      actorId: staff,
      version: 3,
    });

    expect(calls).toEqual(['reserve 2,1', 'commit', 'createShipment']);
    expect(savedOne(orders).snapshot).toMatchObject({
      status: 'PAID',
      paidAt: CAPTURED,
      reservationId: reservation,
    });
    expect(audited).toEqual([
      {
        action: 'orders.retry-fulfillment',
        resource: { type: 'order', id: order.id },
        changes: {
          status: { from: 'AWAITING_MANUAL_FULFILLMENT', to: 'PAID' },
        },
      },
    ]);
  });

  it('checks the status and the version before reserving', async () => {
    const pending = saved('PENDING_PAYMENT');
    const waiting = saved('AWAITING_MANUAL_FULFILLMENT', CAPTURED);
    const wrongStatus = setUp(pending);
    const outdated = setUp(waiting);

    await expect(
      wrongStatus.lifecycle.retryFulfillment({
        orderId: pending.id,
        actorId: staff,
        version: 3,
      }),
    ).rejects.toThrow(
      new InvalidStateTransitionError('PENDING_PAYMENT', 'retry fulfillment'),
    );
    await expect(
      outdated.lifecycle.retryFulfillment({
        orderId: waiting.id,
        actorId: staff,
        version: 1,
      }),
    ).rejects.toThrow(VersionConflictError);
    expect([wrongStatus.calls, outdated.calls]).toEqual([[], []]);
  });

  it('saves nothing when the stock is still short', async () => {
    const order = saved('AWAITING_MANUAL_FULFILLMENT', CAPTURED);
    const { lifecycle, orders, audited } = setUp(order, { available: false });

    await expect(
      lifecycle.retryFulfillment({
        orderId: order.id,
        actorId: staff,
        version: 3,
      }),
    ).rejects.toThrow('insufficient stock');
    expect([orders.saved, audited]).toEqual([[], []]);
  });
});

describe('OrderLifecycle: a captured payment (UC-ORD-09)', () => {
  const pay = (lifecycle: OrderLifecycle, order: Order, amount = 49_800) =>
    lifecycle.recordPayment({
      orderId: order.id,
      amount: mxn(amount),
      capturedAt: CAPTURED,
    });

  it('confirms the reservation of an unpaid order, which is paid when the payment was captured', async () => {
    for (const commit of ['committed', 'already-committed'] as const) {
      const order = saved('PENDING_PAYMENT');
      const { lifecycle, orders, calls } = setUp(order, { commit });

      expect(await pay(lifecycle, order)).toBe('paid');

      expect(calls).toEqual(['commit', 'createShipment']);
      expect(savedOne(orders).snapshot).toMatchObject({
        status: 'PAID',
        paidAt: CAPTURED,
        reservationId: order.snapshot.reservationId,
      });
    }
  });

  it('reserves again when the reservation ended, for an unpaid or an expired order (ADR-0012)', async () => {
    for (const [status, expected] of [
      [
        'PENDING_PAYMENT',
        ['commit', 'reserveIfAvailable 2,1', 'commit', 'createShipment'],
      ],
      ['EXPIRED', ['reserveIfAvailable 2,1', 'commit', 'createShipment']],
    ] as const) {
      const order = saved(status);
      const { lifecycle, orders, calls, reservation } = setUp(order, {
        commit: 'not-active',
      });

      expect(await pay(lifecycle, order)).toBe('paid');

      expect(calls).toEqual(expected);
      expect(savedOne(orders).snapshot).toMatchObject({
        status: 'PAID',
        reservationId: reservation,
      });
    }
  });

  it('leaves a late payment without stock waiting for the staff (BR-ORD-09)', async () => {
    const order = saved('EXPIRED');
    const { lifecycle, orders, calls } = setUp(order, { available: false });

    expect(await pay(lifecycle, order)).toBe('awaiting-manual-fulfillment');

    expect(calls).toEqual(['reserveIfAvailable 2,1']);
    expect(savedOne(orders).snapshot).toMatchObject({
      status: 'AWAITING_MANUAL_FULFILLMENT',
      paidAt: CAPTURED,
    });
  });

  it('keeps the payment of a cancelled order once, without moving it (ADR-0133)', async () => {
    const order = saved('CANCELLED');
    const first = setUp(order);
    const alreadyPaid = saved('CANCELLED', CAPTURED);
    const again = setUp(alreadyPaid);

    expect(await pay(first.lifecycle, order)).toBe('recorded-on-cancelled');
    expect(await pay(again.lifecycle, alreadyPaid)).toBe('already-processed');
    expect(again.orders.saved).toEqual([]);

    expect(savedOne(first.orders).snapshot).toMatchObject({
      status: 'CANCELLED',
      paidAt: CAPTURED,
    });
    expect(first.calls).toEqual(['startRefund']);
  });

  it('changes nothing for an order past payment, a repeated event or another amount (BR-ORD-08)', async () => {
    for (const status of [
      'PAID',
      'AWAITING_MANUAL_FULFILLMENT',
      'SHIPPED',
      'DELIVERED',
      'REFUNDED',
    ] as const) {
      const order = saved(status, CAPTURED);
      const { lifecycle, orders, calls } = setUp(order);

      expect(await pay(lifecycle, order)).toBe('already-processed');
      expect([orders.saved, calls]).toEqual([[], []]);
    }
    const order = saved('PENDING_PAYMENT');
    const { lifecycle, orders, calls } = setUp(order);

    expect(await pay(lifecycle, order, 49_799)).toBe('amount-mismatch');
    expect([orders.saved, calls]).toEqual([[], []]);
  });

  it('answers 404 for an order that does not exist', async () => {
    const { lifecycle } = setUp(saved('PENDING_PAYMENT'));

    await expect(
      lifecycle.recordPayment({
        orderId: newId<'Order'>(),
        amount: mxn(1),
        capturedAt: CAPTURED,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('OrderLifecycle: a completed refund (ADR-0051, ADR-0135)', () => {
  const REFUNDED = new Date('2026-10-01T14:00:00.000Z');

  it('marks a cancelled order with a payment refunded, when the refund completed', async () => {
    const order = saved('CANCELLED', CAPTURED);
    const { lifecycle, orders } = setUp(order);

    expect(
      await lifecycle.recordRefund({
        orderId: order.id,
        completedAt: REFUNDED,
      }),
    ).toBe('refunded');

    expect(savedOne(orders).snapshot).toMatchObject({
      status: 'REFUNDED',
      refundedAt: REFUNDED,
    });
  });

  it('changes nothing for an order already refunded or one that is not a cancelled one with a payment', async () => {
    for (const [order, outcome] of [
      [saved('REFUNDED', CAPTURED), 'already-processed'],
      [saved('CANCELLED'), 'unexpected'],
      [saved('PAID', CAPTURED), 'unexpected'],
    ] as const) {
      const { lifecycle, orders } = setUp(order);

      expect(
        await lifecycle.recordRefund({
          orderId: order.id,
          completedAt: REFUNDED,
        }),
      ).toBe(outcome);
      expect(orders.saved).toEqual([]);
    }
  });

  it('answers 404 for an order that does not exist', async () => {
    const { lifecycle } = setUp(saved('CANCELLED', CAPTURED));

    await expect(
      lifecycle.recordRefund({
        orderId: newId<'Order'>(),
        completedAt: REFUNDED,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('OrderLifecycle: the progress of its shipment (UC-SHI-05 and 06, ADR-0141)', () => {
  const LEFT = new Date('2026-10-01T15:00:00.000Z');
  const DELIVERED = new Date('2026-10-02T10:00:00.000Z');

  it('marks a paid order shipped when its shipment left, without an actor', async () => {
    const order = saved('PAID', CAPTURED);
    const { lifecycle, orders } = setUp(order);

    expect(
      await lifecycle.recordShipment({ orderId: order.id, dispatchedAt: LEFT }),
    ).toBe('moved');

    const shipped = savedOne(orders);
    expect(shipped.snapshot).toMatchObject({
      status: 'SHIPPED',
      shippedAt: LEFT,
    });
    expect(shipped.statusChanges).toEqual([
      { from: 'PAID', to: 'SHIPPED', actorId: null, reason: null, at: NOW },
    ]);
  });

  it('changes nothing for an order already shipped or delivered, nor for one that is not paid', async () => {
    for (const [order, outcome] of [
      [saved('SHIPPED', CAPTURED), 'already-processed'],
      [saved('DELIVERED', CAPTURED), 'already-processed'],
      [saved('PENDING_PAYMENT'), 'unexpected'],
      [saved('AWAITING_MANUAL_FULFILLMENT', CAPTURED), 'unexpected'],
      [saved('CANCELLED', CAPTURED), 'unexpected'],
    ] as const) {
      const { lifecycle, orders } = setUp(order);

      expect(
        await lifecycle.recordShipment({
          orderId: order.id,
          dispatchedAt: LEFT,
        }),
      ).toBe(outcome);
      expect(orders.saved).toEqual([]);
    }
  });

  it('marks a shipped order delivered when its shipment was', async () => {
    const order = saved('SHIPPED', CAPTURED);
    const { lifecycle, orders } = setUp(order);

    expect(
      await lifecycle.recordDelivery({
        orderId: order.id,
        dispatchedAt: LEFT,
        deliveredAt: DELIVERED,
      }),
    ).toBe('moved');

    const delivered = savedOne(orders);
    expect(delivered.snapshot).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: DELIVERED,
    });
    expect(delivered.statusChanges).toEqual([
      {
        from: 'SHIPPED',
        to: 'DELIVERED',
        actorId: null,
        reason: null,
        at: NOW,
      },
    ]);
  });

  it('marks a paid order shipped first, from when its shipment left, when the event of the dispatch is late or lost', async () => {
    const order = saved('PAID', CAPTURED);
    const { lifecycle, orders } = setUp(order);

    expect(
      await lifecycle.recordDelivery({
        orderId: order.id,
        dispatchedAt: LEFT,
        deliveredAt: DELIVERED,
      }),
    ).toBe('moved');

    const delivered = savedOne(orders);
    expect(delivered.snapshot).toMatchObject({
      status: 'DELIVERED',
      shippedAt: LEFT,
      deliveredAt: DELIVERED,
    });
    expect(delivered.statusChanges.map(({ from, to }) => [from, to])).toEqual([
      ['PAID', 'SHIPPED'],
      ['SHIPPED', 'DELIVERED'],
    ]);
  });

  it('changes nothing for an order already delivered, nor for one that is neither paid nor shipped', async () => {
    for (const [order, outcome] of [
      [saved('DELIVERED', CAPTURED), 'already-processed'],
      [saved('AWAITING_MANUAL_FULFILLMENT', CAPTURED), 'unexpected'],
      [saved('CANCELLED', CAPTURED), 'unexpected'],
      [saved('REFUNDED', CAPTURED), 'unexpected'],
    ] as const) {
      const { lifecycle, orders } = setUp(order);

      expect(
        await lifecycle.recordDelivery({
          orderId: order.id,
          dispatchedAt: LEFT,
          deliveredAt: DELIVERED,
        }),
      ).toBe(outcome);
      expect(orders.saved).toEqual([]);
    }
  });

  it('answers 404 for an order that does not exist', async () => {
    const { lifecycle } = setUp(saved('PAID', CAPTURED));

    await expect(
      lifecycle.recordShipment({
        orderId: newId<'Order'>(),
        dispatchedAt: LEFT,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      lifecycle.recordDelivery({
        orderId: newId<'Order'>(),
        dispatchedAt: LEFT,
        deliveredAt: DELIVERED,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
