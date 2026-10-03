import {
  type AuditEntry,
  type AuditTrail,
  InvalidStateTransitionError,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type Buyer,
  type CartId,
  Order,
  type OrderId,
  type OrderStatus,
  priceLine,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { SourceCartUnavailableError } from '../domain/ordering-errors.js';
import type { PublicCode } from '../domain/public-code.js';
import type { OrderingQueries } from './ordering.queries.js';
import { OrderReorders } from './order-reorders.use-case.js';
import type { CartCopy, ReorderCarts } from './reorder-ports.js';

// Test doubles of the unit tests of buying an order again.

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const CODE = 'K7M4Q9XA' as PublicCode;
const shirt = newId<'Variant'>();
const customer = newId<'User'>();
const guest: Buyer = {
  customerId: null,
  contactEmail: 'cliente@example.com',
  privacyNoticeVersion: '2026-09',
};

/** A saved order of 2 shirts, by a guest unless told otherwise. */
function saved(status: OrderStatus, buyer: Buyer = guest): Order {
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: CODE,
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
    reservation: { id: newId<'Reservation'>(), expiresAt: PLACED },
    sourceCartId: newId<'Cart'>(),
    now: PLACED,
  });
  return Order.restore({ ...placed.snapshot, status });
}

const ofCustomer = (status: OrderStatus) =>
  saved(status, { customerId: customer, contactEmail: 'ana@example.com' });

/** One order in memory, found by its ID or its code. */
class OneOrder extends OrderRepository {
  constructor(private readonly order: Order | null) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('Buying again never places an order');
  }

  lock(id: OrderId): Promise<Order | null> {
    return Promise.resolve(this.order?.id === id ? this.order : null);
  }

  lockByPublicCode(code: PublicCode): Promise<Order | null> {
    return Promise.resolve(code === CODE ? this.order : null);
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('Buying again never expires orders');
  }

  lockOf(): Promise<Order[]> {
    throw new Error('Buying again never anonymizes orders');
  }

  save(): Promise<void> {
    throw new Error('Buying again never changes the order');
  }
}

function setUp(
  order: Order | null,
  source: 'available' | 'gone' = 'available',
) {
  const calls: unknown[][] = [];
  const copy = (cartId: CartId): CartCopy => ({
    cartId,
    skippedVariantIds: [],
  });
  const carts = {
    copyToCustomerCart: (...args: unknown[]) => {
      calls.push(['customer', ...args]);
      return Promise.resolve(copy(newId<'Cart'>()));
    },
    copyToGuestCart: (...args: unknown[]) => {
      calls.push(['guest', ...args]);
      return Promise.resolve(copy(newId<'Cart'>()));
    },
    copyToSourceCart: (sourceCartId: CartId, ...rest: unknown[]) => {
      calls.push(['source', sourceCartId, ...rest]);
      return Promise.resolve(
        source === 'available' ? copy(sourceCartId) : null,
      );
    },
  } as unknown as ReorderCarts;
  const asked: string[][] = [];
  const queries = {
    findGuestOrder: (code: string, email: string) => {
      asked.push([code, email]);
      return Promise.resolve(
        order !== null &&
          order.snapshot.customerId === null &&
          email === 'cliente@example.com'
          ? { id: order.id }
          : null,
      );
    },
  } as unknown as OrderingQueries;
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
  return {
    reorders: new OrderReorders(
      new OneOrder(order),
      queries,
      carts,
      inline,
      audit,
    ),
    calls,
    asked,
    audited,
  };
}

const LINES = [{ variantId: shirt, quantity: 2 }];

describe('OrderReorders (UC-CRT-09, ADR-0139)', () => {
  it('copies a cancelled or refunded order of a customer into the customer’s cart', async () => {
    for (const status of ['CANCELLED', 'REFUNDED'] as const) {
      const { reorders, calls, audited } = setUp(ofCustomer(status));

      await reorders.forCustomer({ customerId: customer, publicCode: CODE });

      expect(calls).toEqual([['customer', customer, LINES]]);
      expect(audited).toEqual([]);
    }
  });

  it('answers 404 to a customer for an order that does not exist or is not theirs', async () => {
    for (const order of [null, ofCustomer('CANCELLED'), saved('CANCELLED')]) {
      const { reorders, calls } = setUp(order);

      await expect(
        reorders.forCustomer({
          customerId: order === null ? customer : newId<'User'>(),
          publicCode: CODE,
        }),
      ).rejects.toThrow(NotFoundError);
      expect(calls).toEqual([]);
    }
  });

  it('copies nothing of an order that is not cancelled nor refunded (BR-CRT-11)', async () => {
    for (const status of [
      'PENDING_PAYMENT',
      'PAID',
      'AWAITING_MANUAL_FULFILLMENT',
      'SHIPPED',
      'DELIVERED',
      'EXPIRED',
    ] as const) {
      const { reorders, calls } = setUp(ofCustomer(status));

      await expect(
        reorders.forCustomer({ customerId: customer, publicCode: CODE }),
      ).rejects.toThrow(new InvalidStateTransitionError(status, 'reorder'));
      await expect(reorders.forStaff(newId<'Order'>())).rejects.toThrow(
        NotFoundError,
      );
      expect(calls).toEqual([]);
    }
  });

  it('finds a guest order as the lookup does and copies it into the guest cart given or a new one', async () => {
    const order = saved('CANCELLED');
    const cartId = newId<'Cart'>();
    const { reorders, calls, asked } = setUp(order);

    await reorders.forGuest({
      publicCode: CODE,
      contactEmail: ' Cliente@Example.COM ',
      cartId,
    });
    await reorders.forGuest({
      publicCode: CODE,
      contactEmail: 'cliente@example.com',
      cartId: null,
    });

    expect(asked).toEqual([
      [CODE, 'cliente@example.com'],
      [CODE, 'cliente@example.com'],
    ]);
    expect(calls).toEqual([
      ['guest', cartId, LINES],
      ['guest', null, LINES],
    ]);
  });

  it('answers the same 404 to a guest for every miss, and 409 for an order not cancelled', async () => {
    const pending = setUp(saved('PENDING_PAYMENT'));
    const missing = setUp(saved('CANCELLED'));

    await expect(
      missing.reorders.forGuest({
        publicCode: CODE,
        contactEmail: 'otro@example.com',
        cartId: null,
      }),
    ).rejects.toThrow(
      new NotFoundError('Guest order', 'with that email and code'),
    );
    await expect(
      pending.reorders.forGuest({
        publicCode: CODE,
        contactEmail: 'cliente@example.com',
        cartId: null,
      }),
    ).rejects.toThrow(InvalidStateTransitionError);
    expect([missing.calls, pending.calls]).toEqual([[], []]);
  });

  it('copies for the staff into the customer’s cart or the guest’s own cart, and audits it (ADR-0055, ADR-0082)', async () => {
    const own = ofCustomer('REFUNDED');
    const ofGuest = saved('CANCELLED');
    const forCustomer = setUp(own);
    const forGuest = setUp(ofGuest);

    await forCustomer.reorders.forStaff(own.id);
    expect(await forGuest.reorders.forStaff(ofGuest.id)).toEqual({
      cartId: ofGuest.snapshot.sourceCartId,
      skippedVariantIds: [],
    });

    expect(forCustomer.calls).toEqual([['customer', customer, LINES]]);
    expect(forGuest.calls).toEqual([
      ['source', ofGuest.snapshot.sourceCartId, LINES],
    ]);
    for (const [{ audited }, order] of [
      [forCustomer, own],
      [forGuest, ofGuest],
    ] as const) {
      expect(audited).toEqual([
        {
          action: 'orders.reorder',
          resource: { type: 'order', id: order.id },
        },
      ]);
    }
  });

  it('answers 409 to the staff when the guest’s cart is no longer available, without auditing', async () => {
    const order = saved('CANCELLED');
    const { reorders, audited } = setUp(order, 'gone');

    await expect(reorders.forStaff(order.id)).rejects.toThrow(
      SourceCartUnavailableError,
    );
    expect(audited).toEqual([]);
  });
});
