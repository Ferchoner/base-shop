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
  Order,
  type OrderAddress,
  type OrderId,
  type OrderSnapshot,
  priceLine,
  type ShippingAddress,
  withoutIdentifyingFields,
} from '../domain/order.js';
import type { OrderRepository } from '../domain/order.repository.js';
import type { PublicCode } from '../domain/public-code.js';
import { BlockedOrderData } from './blocked-order-data.js';
import type { OrderShipments } from './shipment-ports.js';

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const BLOCKED = new Date('2027-10-02T09:00:00.000Z');
const REASON = 'Reclamación PROFECO 2027-0153';

const ADDRESS: ShippingAddress = {
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
};
/** Where the staff changed it to, so the shipment shows its own. */
const DESTINATION: OrderAddress = { ...ADDRESS, street: 'Morelos Sur' };

/** A delivered guest order, with the given changes. */
function saved(changes: Partial<OrderSnapshot> = {}): Order {
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
    shippingAddress: ADDRESS,
    reservation: { id: newId<'Reservation'>(), expiresAt: PLACED },
    sourceCartId: newId<'Cart'>(),
    now: PLACED,
  });
  return Order.restore({
    ...placed.snapshot,
    status: 'DELIVERED',
    concludedAt: PLACED,
    version: 4,
    ...changes,
  });
}

function setUp(
  order: Order | null,
  options: { destination?: OrderAddress | null; auditFails?: boolean } = {},
) {
  const locked: OrderId[] = [];
  const orders = {
    lock: (id: OrderId) => {
      locked.push(id);
      return Promise.resolve(order?.id === id ? order : null);
    },
  } as unknown as OrderRepository;
  const shipments = {
    destinationOf: () =>
      Promise.resolve(
        options.destination === undefined ? DESTINATION : options.destination,
      ),
  } as unknown as OrderShipments;
  let transactions = 0;
  const inline = {
    run: <T>(work: () => Promise<T>) => {
      transactions += 1;
      return work();
    },
  } as unknown as TransactionManager;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      if (options.auditFails === true) {
        return Promise.reject(new Error('The audit trail is down'));
      }
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const data = new BlockedOrderData(orders, shipments, inline, audit);
  return { data, locked, audited, transactions: () => transactions };
}

describe('BlockedOrderData (ADR-0070, ADR-0152)', () => {
  it('answers the email, the address and the destination of a blocked order as saved, audited with the reason and without them', async () => {
    const order = saved({ blockedAt: BLOCKED });
    const { data, locked, audited, transactions } = setUp(order);

    expect(await data.read({ orderId: order.id, reason: REASON })).toEqual({
      contactEmail: 'cliente@example.com',
      shippingAddress: ADDRESS,
      shipmentDestination: DESTINATION,
    });
    expect(locked).toEqual([order.id]);
    expect(transactions()).toBe(1);
    expect(audited).toEqual([
      {
        action: 'orders.read-blocked-data',
        resource: { type: 'order', id: order.id },
        reason: REASON,
      },
    ]);
  });

  it('answers no destination for an order without a shipment', async () => {
    const order = saved({ blockedAt: BLOCKED });
    const { data } = setUp(order, { destination: null });

    expect(
      (await data.read({ orderId: order.id, reason: REASON }))
        .shipmentDestination,
    ).toBeNull();
  });

  it('answers nothing when the audit fails', async () => {
    const order = saved({ blockedAt: BLOCKED });
    const { data } = setUp(order, { auditFails: true });

    await expect(
      data.read({ orderId: order.id, reason: REASON }),
    ).rejects.toThrow('The audit trail is down');
  });

  it('answers 404 for an order that does not exist', async () => {
    const { data, audited } = setUp(null);
    const orderId = newId<'Order'>();

    await expect(data.read({ orderId, reason: REASON })).rejects.toThrow(
      new NotFoundError('Order', orderId),
    );
    expect(audited).toEqual([]);
  });

  it('refuses an order that is not blocked, whose data the staff sees, and an anonymized one, which has none, without auditing', async () => {
    for (const order of [
      saved(),
      saved({
        blockedAt: BLOCKED,
        anonymizedAt: BLOCKED,
        contactEmail: null,
        shippingAddress: withoutIdentifyingFields(ADDRESS),
      }),
      saved({ anonymizedAt: BLOCKED, contactEmail: null }),
    ]) {
      const { data, audited } = setUp(order);

      await expect(
        data.read({ orderId: order.id, reason: REASON }),
      ).rejects.toThrow(
        new InvalidStateTransitionError('DELIVERED', 'read blocked data'),
      );
      expect(audited).toEqual([]);
    }
  });
});
