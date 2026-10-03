import {
  type AuditEntry,
  type AuditTrail,
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
import type { OrderAccessTokenRepository } from '../domain/order-access-token.js';
import { OrderRepository, type OrdersOf } from '../domain/order.repository.js';
import { ActiveOrdersExistError } from '../domain/ordering-errors.js';
import type { PublicCode } from '../domain/public-code.js';
import { OrderAnonymizations } from './order-anonymizations.use-case.js';
import type { PlacementResponses } from './placement-responses.js';
import type { OrderShipment, OrderShipments } from './shipment-ports.js';

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const AT = new Date('2026-10-02T15:00:00.000Z');
const PAID = new Date('2026-10-01T12:30:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');
const customer = newId<'User'>() as CustomerId;

/** A saved order of one shirt, in `status`, at version 3. */
function saved(
  status: OrderStatus,
  code: string,
  paidAt: Date | null = null,
): Order {
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: code as PublicCode,
    buyer: {
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
    },
    lines: [
      priceLine(
        {
          variantId: newId<'Variant'>(),
          sku: 'CAM-M',
          productName: 'Camisa',
          variantOptions: {},
          unitPrice: mxn(10_000),
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
      recipientName: 'María López',
      phone: '4431234567',
      street: 'Madero',
      exteriorNumber: '1',
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
    reservation: { id: newId<'Reservation'>(), expiresAt: PLACED },
    sourceCartId: newId<'Cart'>(),
    now: PLACED,
  });
  return Order.restore({ ...placed.snapshot, status, paidAt, version: 3 });
}

/** The orders of a buyer: `lockOf` answers them and records whose; `save` records each one. */
class BuyerOrders extends OrderRepository {
  readonly asked: OrdersOf[] = [];
  readonly saved: Order[] = [];

  constructor(private readonly orders: Order[]) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('Anonymizing never places orders');
  }

  lock(): Promise<Order | null> {
    throw new Error('Anonymizing locks the orders of the buyer at once');
  }

  lockByPublicCode(): Promise<Order | null> {
    throw new Error('Anonymizing locks the orders of the buyer at once');
  }

  lockOf(buyer: OrdersOf): Promise<Order[]> {
    this.asked.push(buyer);
    return Promise.resolve(this.orders);
  }

  dueForBlocking(): Promise<OrderId[]> {
    throw new Error('This test never blocks orders');
  }

  dueForAnonymization(): Promise<OrderId[]> {
    throw new Error('This test never anonymizes orders by their date');
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('Anonymizing never expires orders');
  }

  save(order: Order, now: Date): Promise<void> {
    expect(now).toBe(AT);
    this.saved.push(order);
    return Promise.resolve();
  }
}

function setUp(orders: Order[], shipmentStatuses: Record<string, string> = {}) {
  const repository = new BuyerOrders(orders);
  const calls: string[] = [];
  const shipments = {
    shipmentsOf: (ids: readonly OrderId[]) => {
      calls.push(`shipmentsOf ${ids.length}`);
      return Promise.resolve(
        new Map(
          ids
            .filter((id) => shipmentStatuses[id] !== undefined)
            .map((id) => [
              id,
              { status: shipmentStatuses[id] } as OrderShipment,
            ]),
        ),
      );
    },
    anonymize: (ids: readonly OrderId[], at: Date) => {
      expect(at).toBe(AT);
      calls.push(`anonymize ${ids.join(',')}`);
      return Promise.resolve();
    },
  } as unknown as OrderShipments;
  const accessTokens = {
    deleteOf: (contactEmail: string) => {
      calls.push(`deleteOf ${contactEmail}`);
      return Promise.resolve();
    },
  } as unknown as OrderAccessTokenRepository;
  const responses = {
    forgetOf: (forgotten: readonly Order[]) => {
      calls.push(`forgetOf ${forgotten.map(({ id }) => id).join(',')}`);
      return Promise.resolve();
    },
  } as unknown as PlacementResponses;
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
    anonymizations: new OrderAnonymizations(
      repository,
      shipments,
      accessTokens,
      responses,
      inline,
      audit,
    ),
    repository,
    calls,
    audited,
  };
}

describe('OrderAnonymizations (UC-IAM-19, ADR-0067, ADR-0145)', () => {
  it("anonymizes every order of a customer and their shipments, auditing each one without the values, with the request's reference", async () => {
    const delivered = saved('DELIVERED', 'K7M4Q9XA', PAID);
    const returned = saved('SHIPPED', 'H3N8P2WB', PAID);
    const expired = saved('EXPIRED', 'M5R7T1YC');
    const { anonymizations, repository, calls, audited } = setUp(
      [delivered, returned, expired],
      { [delivered.id]: 'DELIVERED', [returned.id]: 'RETURNED' },
    );

    const count = await anonymizations.anonymize({
      buyer: { customerId: customer },
      reason: 'ARCO-2026-0042',
      at: AT,
    });

    expect(count).toBe(3);
    expect(repository.asked).toEqual([{ customerId: customer }]);
    expect(repository.saved).toEqual([delivered, returned, expired]);
    for (const order of repository.saved) {
      expect(order.snapshot).toMatchObject({
        contactEmail: null,
        shippingAddress: { recipientName: null, postalCode: '58000' },
        anonymizedAt: AT,
      });
    }
    expect(calls).toEqual([
      'shipmentsOf 3',
      `anonymize ${delivered.id},${returned.id},${expired.id}`,
      `forgetOf ${delivered.id},${returned.id},${expired.id}`,
    ]);
    expect(audited).toEqual(
      [delivered, returned, expired].map((order) => ({
        action: 'orders.anonymize',
        resource: { type: 'order', id: order.id },
        changes: {
          contactEmail: { changed: true },
          shippingAddress: { changed: true },
        },
        reason: 'ARCO-2026-0042',
      })),
    );
  });

  it('anonymizes nothing while an order has not concluded (E-31)', async () => {
    const delivered = saved('DELIVERED', 'K7M4Q9XA', PAID);
    const failed = saved('SHIPPED', 'H3N8P2WB', PAID);
    const { anonymizations, repository, calls, audited } = setUp(
      [delivered, failed],
      { [delivered.id]: 'DELIVERED', [failed.id]: 'DELIVERY_FAILED' },
    );

    await expect(
      anonymizations.anonymize({
        buyer: { customerId: customer },
        reason: 'ARCO-2026-0042',
        at: AT,
      }),
    ).rejects.toThrow(ActiveOrdersExistError);
    expect([repository.saved, audited]).toEqual([[], []]);
    expect(calls).toEqual(['shipmentsOf 2']);
  });

  it('answers 0 for a customer without orders, asking nothing else', async () => {
    const { anonymizations, calls, audited } = setUp([]);

    expect(
      await anonymizations.anonymize({
        buyer: { customerId: customer },
        reason: 'ARCO-2026-0042',
        at: AT,
      }),
    ).toBe(0);
    expect([calls, audited]).toEqual([[], []]);
  });

  it('anonymizes the guest orders with the email, normalized, when the code is of one of them, with or without dash, and deletes the access links of the email (ADR-0148)', async () => {
    const first = saved('DELIVERED', 'K7M4Q9XA', PAID);
    const second = saved('CANCELLED', 'H3N8P2WB');
    const { anonymizations, repository, calls } = setUp([first, second], {
      [first.id]: 'DELIVERED',
    });

    const count = await anonymizations.anonymize({
      buyer: { contactEmail: ' Cliente@Example.COM ', publicCode: 'h3n8-p2wb' },
      reason: 'ARCO-2026-0043',
      at: AT,
    });

    expect(count).toBe(2);
    expect(repository.asked).toEqual([{ guestEmail: 'cliente@example.com' }]);
    expect(repository.saved).toEqual([first, second]);
    expect(calls).toEqual([
      'shipmentsOf 2',
      `anonymize ${first.id},${second.id}`,
      'deleteOf cliente@example.com',
      `forgetOf ${first.id},${second.id}`,
    ]);
  });

  it('answers the same 404 as the lookup when no guest order with the email has the code, or the code cannot exist (BR-ORD-11)', async () => {
    for (const [orders, publicCode] of [
      [[saved('DELIVERED', 'K7M4Q9XA', PAID)], 'H3N8P2WB'],
      [[saved('DELIVERED', 'K7M4Q9XA', PAID)], 'not a code'],
      [[], 'K7M4Q9XA'],
    ] as const) {
      const { anonymizations, repository, calls } = setUp([...orders]);

      const anonymizing = anonymizations.anonymize({
        buyer: { contactEmail: 'cliente@example.com', publicCode },
        reason: 'ARCO-2026-0043',
        at: AT,
      });

      await expect(anonymizing).rejects.toThrow(NotFoundError);
      await expect(anonymizing).rejects.toThrow(
        'Guest order with that email and code does not exist',
      );
      expect([repository.saved, calls]).toEqual([[], []]);
    }
  });
});
