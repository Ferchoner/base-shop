import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  type DomainEvent,
  type DomainEventPublisher,
  Money,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type Buyer,
  Order,
  type OrderId,
  type OrderStatus,
  priceLine,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';
import type { OrderStock } from './checkout-ports.js';
import {
  EXPIRY_BATCH_SIZE,
  OrderExpiry,
  type OrderExpired,
} from './order-expiry.use-case.js';

// Test doubles of the unit tests of the expiration of orders.

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const DUE = new Date('2026-10-01T12:20:00.000Z');
const NOW = new Date('2026-10-01T12:21:00.000Z');
const shirt = newId<'Variant'>();
const guest: Buyer = {
  customerId: null,
  contactEmail: 'cliente@example.com',
  privacyNoticeVersion: '2026-09',
};

/** A saved order of 2 shirts, due at `DUE`. */
function saved(
  status: OrderStatus = 'PENDING_PAYMENT',
  buyer: Buyer = guest,
): Order {
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: 'K7M4Q9XA' as PublicCode,
    buyer,
    lines: [
      priceLine(
        {
          variantId: shirt,
          sku: 'CAM-M',
          productName: 'Camisa',
          variantOptions: {},
          unitPrice: Money.of(10_000, 'MXN'),
          quantity: 2,
        },
        1600,
      ),
    ],
    shipping: {
      cost: Money.of(9_900, 'MXN'),
      taxAmount: Money.of(1_366, 'MXN'),
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
    reservation: { id: newId<'Reservation'>(), expiresAt: DUE },
    sourceCartId: newId<'Cart'>(),
    now: PLACED,
  });
  return Order.restore({ ...placed.snapshot, status });
}

/** Orders in memory: `dueForExpiry` answers `due`, `lock` a fresh copy, and saving `failing` fails. */
class InMemoryOrders extends OrderRepository {
  readonly saved: Order[] = [];
  readonly asked: [Date, number][] = [];
  readonly failing = new Set<OrderId>();
  private readonly orders = new Map<OrderId, Order>();

  constructor(
    private readonly due: OrderId[],
    ...orders: Order[]
  ) {
    super();
    for (const order of orders) this.orders.set(order.id, order);
  }

  insert(): Promise<boolean> {
    throw new Error('Expiring never places an order');
  }

  lock(id: OrderId): Promise<Order | null> {
    const order = this.orders.get(id);
    return Promise.resolve(
      order === undefined ? null : Order.restore(order.snapshot),
    );
  }

  lockByPublicCode(): Promise<Order | null> {
    throw new Error('Expiring finds orders by their ID');
  }

  lockOf(): Promise<Order[]> {
    throw new Error('Expiring never anonymizes orders');
  }

  dueForExpiry(at: Date, limit: number): Promise<OrderId[]> {
    this.asked.push([at, limit]);
    return Promise.resolve(this.due);
  }

  save(order: Order, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    if (this.failing.has(order.id)) {
      return Promise.reject(new Error('The database went away'));
    }
    this.saved.push(order);
    return Promise.resolve();
  }
}

/** `stored` are the orders that exist; `due`, what the query answers, all of them by default. */
function setUp(stored: Order[], due: OrderId[] = stored.map(({ id }) => id)) {
  const orders = new InMemoryOrders(due, ...stored);
  const expiredReservations: OrderId[] = [];
  const stock = {
    expire: (orderId: OrderId) => {
      expiredReservations.push(orderId);
      return Promise.resolve(true);
    },
  } as unknown as OrderStock;
  let transactions = 0;
  const inline = {
    run: <T>(work: () => Promise<T>) => {
      transactions += 1;
      return work();
    },
  } as unknown as TransactionManager;
  const published: DomainEvent[] = [];
  const events = {
    publish: (event: DomainEvent) => published.push(event),
  } as unknown as DomainEventPublisher;
  const expiry = new OrderExpiry(orders, stock, inline, events, {
    now: () => NOW,
  });
  return {
    expiry,
    orders,
    expiredReservations,
    published,
    transactions: () => transactions,
  };
}

describe('OrderExpiry (UC-ORD-10, UC-INV-08, ADR-0136)', () => {
  let error: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('expires each due order with its reservation, in its own transaction, and announces it', async () => {
    const ofGuest = saved();
    const customerId = newId<'User'>();
    const ofCustomer = saved('PENDING_PAYMENT', {
      customerId,
      contactEmail: 'ana@example.com',
    });
    const { expiry, orders, expiredReservations, published, transactions } =
      setUp([ofGuest, ofCustomer]);

    expect(await expiry.expireDue()).toEqual({ expired: 2, failed: 0 });

    expect(orders.asked).toEqual([[NOW, EXPIRY_BATCH_SIZE]]);
    expect(EXPIRY_BATCH_SIZE).toBe(100);
    expect(transactions()).toBe(2);
    expect(expiredReservations).toEqual([ofGuest.id, ofCustomer.id]);
    expect(orders.saved.map(({ id, status }) => [id, status])).toEqual([
      [ofGuest.id, 'EXPIRED'],
      [ofCustomer.id, 'EXPIRED'],
    ]);
    expect(published).toEqual(
      [
        [ofGuest, null],
        [ofCustomer, customerId],
      ].map(([order, customer]) => ({
        eventId: expect.any(String),
        eventType: 'OrderExpired',
        occurredAt: NOW,
        orderId: (order as Order).id,
        customerId: customer,
        sourceCartId: (order as Order).snapshot.sourceCartId,
        lines: [{ variantId: shirt, quantity: 2 }],
      })),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('leaves an order that was paid, cancelled or not due yet when it was locked, or that is gone', async () => {
    const paid = saved('PAID');
    const cancelled = saved('CANCELLED');
    const notDue = Order.restore({
      ...saved().snapshot,
      paymentDueAt: new Date(NOW.getTime() + 1),
    });
    const stored = [paid, cancelled, notDue];
    const { expiry, orders, expiredReservations, published } = setUp(stored, [
      ...stored.map(({ id }) => id),
      newId<'Order'>(),
    ]);

    expect(await expiry.expireDue()).toEqual({ expired: 0, failed: 0 });

    expect([orders.saved, expiredReservations, published]).toEqual([
      [],
      [],
      [],
    ]);
  });

  it('logs an order that cannot expire and goes on with the rest (ADR-0029)', async () => {
    const broken = saved();
    const fine = saved();
    const { expiry, orders, published } = setUp([broken, fine]);
    orders.failing.add(broken.id);

    expect(await expiry.expireDue()).toEqual({ expired: 1, failed: 1 });

    expect(orders.saved.map(({ id }) => id)).toEqual([fine.id]);
    expect(published.map((event) => (event as OrderExpired).orderId)).toEqual([
      fine.id,
    ]);
    expect(error).toHaveBeenCalledWith(
      `Order ${broken.id} could not expire`,
      expect.stringContaining('The database went away'),
    );
  });
});
