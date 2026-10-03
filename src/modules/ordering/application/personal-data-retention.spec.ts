import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  type AuditEntry,
  type AuditTrail,
  Money,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  Order,
  type OrderId,
  type OrderSnapshot,
  type OrderStatus,
  priceLine,
} from '../domain/order.js';
import type { OrderAccessTokenRepository } from '../domain/order-access-token.js';
import { OrderRepository } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';
import {
  PersonalDataRetention,
  type PersonalDataRetentionPolicy,
  RETENTION_BATCH_SIZE,
  RETENTION_REASON,
} from './personal-data-retention.js';
import type { OrderShipment, OrderShipments } from './shipment-ports.js';

const NOW = new Date('2027-10-31T09:00:00.000Z');
/** 12 months before NOW, on the last day of September. */
const BLOCK_BY = new Date('2026-10-31T09:00:00.000Z');
/** 12 + 60 months before NOW. */
const ANONYMIZE_BY = new Date('2021-10-31T09:00:00.000Z');
const POLICY: PersonalDataRetentionPolicy = {
  enabled: true,
  operationalMonths: 12,
  blockedMonths: 60,
};

/** A saved order of a guest in `status`, as the retention reads it. */
function saved(
  status: OrderStatus,
  changes: Partial<OrderSnapshot> = {},
  customerId: string | null = null,
): Order {
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: 'K7M4Q9XA' as PublicCode,
    buyer:
      customerId === null
        ? {
            customerId: null,
            contactEmail: 'cliente@example.com',
            privacyNoticeVersion: '2026-09',
          }
        : { customerId: customerId as never, contactEmail: 'ana@example.com' },
    lines: [
      priceLine(
        {
          variantId: newId<'Variant'>(),
          sku: 'CAM-M',
          productName: 'Camisa',
          variantOptions: {},
          unitPrice: Money.of(10_000, 'MXN'),
          quantity: 1,
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
      recipientName: 'María López',
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
    reservation: { id: newId<'Reservation'>(), expiresAt: NOW },
    sourceCartId: newId<'Cart'>(),
    now: NOW,
  });
  return Order.restore({ ...placed.snapshot, status, version: 3, ...changes });
}

/** Orders by ID; the due lists answer what each test says, and every call goes to `calls`. */
class SomeOrders extends OrderRepository {
  readonly saved: Order[] = [];
  toBlock: OrderId[] = [];
  toAnonymize: OrderId[] = [];

  constructor(
    private readonly orders: Map<OrderId, Order>,
    private readonly calls: string[],
  ) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('The retention never places orders');
  }

  lock(id: OrderId): Promise<Order | null> {
    this.calls.push(`lock ${id}`);
    return Promise.resolve(this.orders.get(id) ?? null);
  }

  lockByPublicCode(): Promise<Order | null> {
    throw new Error('The retention locks orders by ID');
  }

  lockOf(): Promise<Order[]> {
    throw new Error('The retention locks orders one by one');
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('The retention never expires orders');
  }

  dueForBlocking(cutoff: Date, limit: number): Promise<OrderId[]> {
    this.calls.push(`dueForBlocking ${cutoff.toISOString()} ${limit}`);
    return Promise.resolve(this.toBlock);
  }

  dueForAnonymization(cutoff: Date, limit: number): Promise<OrderId[]> {
    this.calls.push(`dueForAnonymization ${cutoff.toISOString()} ${limit}`);
    return Promise.resolve(this.toAnonymize);
  }

  save(order: Order, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.calls.push(`save ${order.id}`);
    this.saved.push(order);
    return Promise.resolve();
  }
}

function setUp(
  orders: Order[],
  options: {
    policy?: PersonalDataRetentionPolicy;
    shipmentStatus?: string;
    failingId?: OrderId;
  } = {},
) {
  const calls: string[] = [];
  const repository = new SomeOrders(
    new Map(orders.map((order) => [order.id, order])),
    calls,
  );
  const shipments = {
    block: (ids: readonly OrderId[], at: Date) => {
      expect(at).toBe(NOW);
      calls.push(`block shipments ${ids.join(',')}`);
      return Promise.resolve();
    },
    anonymize: (ids: readonly OrderId[], at: Date) => {
      expect(at).toBe(NOW);
      if (ids.includes(options.failingId as OrderId)) {
        return Promise.reject(new Error('Shipping is down'));
      }
      calls.push(`anonymize shipments ${ids.join(',')}`);
      return Promise.resolve();
    },
    shipmentsOf: (ids: readonly OrderId[]) =>
      Promise.resolve(
        new Map(
          options.shipmentStatus === undefined
            ? []
            : ids.map((id) => [
                id,
                { status: options.shipmentStatus } as OrderShipment,
              ]),
        ),
      ),
  } as unknown as OrderShipments;
  const accessTokens = {
    deleteOf: (contactEmail: string) => {
      calls.push(`delete access links ${contactEmail}`);
      return Promise.resolve();
    },
  } as unknown as OrderAccessTokenRepository;
  const transactions = {
    run: async <T>(work: () => Promise<T>) => {
      const result = await work();
      calls.push('commit');
      return result;
    },
  } as unknown as TransactionManager;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const retention = new PersonalDataRetention(
    repository,
    shipments,
    accessTokens,
    transactions,
    audit,
    { now: () => NOW },
    options.policy ?? POLICY,
  );
  return { retention, repository, calls, audited };
}

describe('PersonalDataRetention (UC-SYS-02, ADR-0070, ADR-0149)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing while the cycle is disabled', async () => {
    const { retention, calls } = setUp([], {
      policy: { ...POLICY, enabled: false },
    });

    expect(await retention.run()).toEqual({
      blocked: 0,
      anonymized: 0,
      failed: 0,
    });
    expect(calls).toEqual([]);
  });

  it('asks for the orders due by each cutoff, in calendar months, up to its batch', async () => {
    const { retention, calls } = setUp([]);

    await retention.run();

    expect(calls).toEqual([
      `dueForBlocking ${BLOCK_BY.toISOString()} 1000`,
      `dueForAnonymization ${ANONYMIZE_BY.toISOString()} 1000`,
    ]);
    expect(RETENTION_BATCH_SIZE).toBe(1_000);
  });

  it('blocks an order and its shipment, each in its transaction, and audits it as the system without values', async () => {
    const order = saved('DELIVERED', { concludedAt: BLOCK_BY });
    const { retention, repository, calls, audited } = setUp([order]);
    repository.toBlock = [order.id];

    expect(await retention.run()).toEqual({
      blocked: 1,
      anonymized: 0,
      failed: 0,
    });

    expect(order.snapshot.blockedAt).toBe(NOW);
    expect(calls.slice(1, 5)).toEqual([
      `lock ${order.id}`,
      `save ${order.id}`,
      `block shipments ${order.id}`,
      'commit',
    ]);
    expect(audited).toEqual([
      {
        action: 'orders.block',
        actor: { type: 'SYSTEM' },
        resource: { type: 'order', id: order.id },
        changes: { blockedAt: { from: null, to: NOW.toISOString() } },
      },
    ]);
  });

  it('leaves alone an order that is no longer due when it is locked: reopened, or blocked meanwhile', async () => {
    const reopened = saved('PAID');
    const blocked = saved('DELIVERED', {
      concludedAt: BLOCK_BY,
      blockedAt: BLOCK_BY,
    });
    const { retention, repository, audited } = setUp([reopened, blocked]);
    repository.toBlock = [reopened.id, blocked.id, newId<'Order'>()];

    expect((await retention.run()).blocked).toBe(0);
    expect([repository.saved, audited]).toEqual([[], []]);
  });

  it('anonymizes a guest order, its shipment and the access links of its email, audited with the reason of the cycle', async () => {
    const order = saved('SHIPPED', {
      concludedAt: ANONYMIZE_BY,
      blockedAt: BLOCK_BY,
    });
    const { retention, repository, calls, audited } = setUp([order], {
      shipmentStatus: 'RETURNED',
    });
    repository.toAnonymize = [order.id];

    expect(await retention.run()).toEqual({
      blocked: 0,
      anonymized: 1,
      failed: 0,
    });

    expect(order.snapshot).toMatchObject({
      contactEmail: null,
      anonymizedAt: NOW,
    });
    expect(calls.slice(2)).toEqual([
      `lock ${order.id}`,
      `save ${order.id}`,
      `anonymize shipments ${order.id}`,
      'delete access links cliente@example.com',
      'commit',
    ]);
    expect(audited).toEqual([
      {
        action: 'orders.anonymize',
        actor: { type: 'SYSTEM' },
        resource: { type: 'order', id: order.id },
        changes: {
          contactEmail: { changed: true },
          shippingAddress: { changed: true },
        },
        reason: RETENTION_REASON,
      },
    ]);
  });

  it("keeps the access links of a customer's email, which are not the order's", async () => {
    const order = saved(
      'DELIVERED',
      { concludedAt: ANONYMIZE_BY },
      newId<'User'>(),
    );
    const { retention, repository, calls } = setUp([order]);
    repository.toAnonymize = [order.id];

    expect((await retention.run()).anonymized).toBe(1);
    expect(calls.some((call) => call.startsWith('delete access links'))).toBe(
      false,
    );
  });

  it('leaves alone an order already anonymized, or not due by then', async () => {
    const anonymized = saved('DELIVERED', {
      concludedAt: ANONYMIZE_BY,
      anonymizedAt: ANONYMIZE_BY,
    });
    const notDue = saved('DELIVERED', {
      concludedAt: new Date(ANONYMIZE_BY.getTime() + 1),
    });
    const { retention, repository, audited } = setUp([anonymized, notDue]);
    repository.toAnonymize = [anonymized.id, notDue.id];

    expect((await retention.run()).anonymized).toBe(0);
    expect([repository.saved, audited]).toEqual([[], []]);
  });

  it('logs an order that fails, and goes on with the others', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const failing = saved('DELIVERED', { concludedAt: ANONYMIZE_BY });
    const next = saved('DELIVERED', { concludedAt: ANONYMIZE_BY });
    const { retention, repository } = setUp([failing, next], {
      failingId: failing.id,
    });
    repository.toAnonymize = [failing.id, next.id];

    expect(await retention.run()).toEqual({
      blocked: 0,
      anonymized: 1,
      failed: 1,
    });
    expect(error).toHaveBeenCalledWith(
      `Retention could not anonymize order ${failing.id}`,
      expect.stringContaining('Shipping is down'),
    );
  });

  it('anonymizes an order when it would be blocked, with no blocked phase', async () => {
    const order = saved('DELIVERED', { concludedAt: BLOCK_BY });
    const { retention, calls } = setUp([order], {
      policy: { ...POLICY, blockedMonths: 0 },
    });

    await retention.run();

    expect(calls.slice(0, 2)).toEqual([
      `dueForBlocking ${BLOCK_BY.toISOString()} 1000`,
      `dueForAnonymization ${BLOCK_BY.toISOString()} 1000`,
    ]);
  });
});
