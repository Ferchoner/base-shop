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
  type OrderId,
  type OrderStatus,
  priceLine,
  type RestockLine,
  type RestockReason,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { UnknownOrderLineError } from '../domain/ordering-errors.js';
import type { PublicCode } from '../domain/public-code.js';
import type { OrderStock, RestockMovement } from './checkout-ports.js';
import { OrderRestocks } from './order-restocks.use-case.js';
import type { OrderShipment, OrderShipments } from './shipment-ports.js';

const PLACED = new Date('2026-10-01T12:00:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');
const staff = newId<'User'>();
const [shirt, cap] = [newId<'Variant'>(), newId<'Variant'>()];

/** A saved order of 2 shirts and a cap in `status`. */
function saved(status: OrderStatus): Order {
  const line = (variantId: typeof shirt, quantity: number) =>
    priceLine(
      {
        variantId,
        sku: 'SKU',
        productName: 'Producto',
        variantOptions: {},
        unitPrice: mxn(10_000),
        quantity,
      },
      1600,
    );
  const placed = Order.place({
    id: newId<'Order'>(),
    publicCode: 'K7M4Q9XA' as PublicCode,
    buyer: {
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
    },
    lines: [line(shirt, 2), line(cap, 1)],
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
  return Order.restore({ ...placed.snapshot, status, version: 4 });
}

class OneOrder extends OrderRepository {
  readonly locked: OrderId[] = [];

  constructor(private readonly order: Order) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('A restock never places an order');
  }

  lock(id: OrderId): Promise<Order | null> {
    this.locked.push(id);
    return Promise.resolve(id === this.order.id ? this.order : null);
  }

  lockByPublicCode(): Promise<Order | null> {
    throw new Error('A restock finds the order by its ID');
  }

  dueForBlocking(): Promise<OrderId[]> {
    throw new Error('This test never blocks orders');
  }

  dueForAnonymization(): Promise<OrderId[]> {
    throw new Error('This test never anonymizes orders by their date');
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('A restock never looks for due orders');
  }

  lockOf(): Promise<Order[]> {
    throw new Error('A restock never anonymizes orders');
  }

  save(): Promise<void> {
    throw new Error('A restock never changes the order');
  }
}

function setUp(order: Order, shipment: Partial<OrderShipment> | null = null) {
  const orders = new OneOrder(order);
  const restocked: {
    orderId: OrderId;
    reasonCode: RestockReason;
    note: string | null;
    actorId: string;
    lines: readonly RestockLine[];
  }[] = [];
  const movement = { id: newId() } as unknown as RestockMovement;
  const stock = {
    restock: (input: (typeof restocked)[number]) => {
      restocked.push(input);
      return Promise.resolve([movement]);
    },
  } as unknown as OrderStock;
  const shipmentsAsked: OrderId[][] = [];
  const shipments = {
    shipmentsOf: (ids: readonly OrderId[]) => {
      shipmentsAsked.push([...ids]);
      return Promise.resolve(
        new Map(
          shipment === null
            ? []
            : [[order.id, { status: 'PENDING', ...shipment } as OrderShipment]],
        ),
      );
    },
  } as unknown as OrderShipments;
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
  const restocks = new OrderRestocks(orders, stock, shipments, inline, audit);
  return {
    restocks,
    orders,
    restocked,
    shipmentsAsked,
    audited,
    movement,
  };
}

describe('OrderRestocks (UC-INV-09, ADR-0052, ADR-0142)', () => {
  it('brings back lines of a cancelled order with what they sold, audited with the note as its reason', async () => {
    const order = saved('CANCELLED');
    const [shirtLine, capLine] = order.snapshot.lines;
    const { restocks, orders, restocked, shipmentsAsked, audited, movement } =
      setUp(order);

    const movements = await restocks.restock({
      orderId: order.id,
      reasonCode: 'ORDER_CANCELLED',
      lines: [{ orderLineId: shirtLine.id, quantity: 1 }],
      note: 'Regresó en su caja',
      actorId: staff,
    });

    expect(movements).toEqual([movement]);
    expect(orders.locked).toEqual([order.id]);
    expect(restocked).toEqual([
      {
        orderId: order.id,
        reasonCode: 'ORDER_CANCELLED',
        note: 'Regresó en su caja',
        actorId: staff,
        lines: [
          {
            orderLineId: shirtLine.id,
            variantId: shirt,
            sold: 2,
            quantity: 1,
          },
        ],
      },
    ]);
    expect(shipmentsAsked).toEqual([]);
    expect(audited).toEqual([
      {
        action: 'orders.restock',
        resource: { type: 'order', id: order.id },
        changes: {
          reasonCode: { from: null, to: 'ORDER_CANCELLED' },
          lines: {
            from: null,
            to: [{ orderLineId: shirtLine.id, quantity: 1 }],
          },
        },
        reason: 'Regresó en su caja',
      },
    ]);
    expect(capLine.variantId).toBe(cap);
  });

  it('brings back the lines of a returned shipment, audited without a reason when there is no note', async () => {
    const order = saved('SHIPPED');
    const [, capLine] = order.snapshot.lines;
    const { restocks, restocked, shipmentsAsked, audited } = setUp(order, {
      status: 'RETURNED',
    });

    await restocks.restock({
      orderId: order.id,
      reasonCode: 'SHIPMENT_RETURNED',
      lines: [{ orderLineId: capLine.id, quantity: 1 }],
      note: null,
      actorId: staff,
    });

    expect(shipmentsAsked).toEqual([[order.id]]);
    expect(restocked[0]).toMatchObject({
      reasonCode: 'SHIPMENT_RETURNED',
      note: null,
      lines: [{ orderLineId: capLine.id, variantId: cap, sold: 1 }],
    });
    expect(audited[0]).not.toHaveProperty('reason');
  });

  it('checks the order, then whether it takes the restock, then its lines, restocking and auditing nothing', async () => {
    const paid = saved('PAID');
    const failed = saved('SHIPPED');
    const unshipped = saved('SHIPPED');
    const cancelled = saved('CANCELLED');
    const cases = [
      {
        setUp: setUp(paid),
        input: { orderId: newId<'Order'>(), reasonCode: 'ORDER_CANCELLED' },
        error: NotFoundError,
      },
      {
        setUp: setUp(paid),
        input: { orderId: paid.id, reasonCode: 'ORDER_CANCELLED' },
        error: new InvalidStateTransitionError('PAID', 'restock'),
      },
      {
        setUp: setUp(failed, { status: 'DELIVERY_FAILED' }),
        input: { orderId: failed.id, reasonCode: 'SHIPMENT_RETURNED' },
        error: new InvalidStateTransitionError(
          'DELIVERY_FAILED',
          'restock the return',
        ),
      },
      {
        setUp: setUp(unshipped),
        input: { orderId: unshipped.id, reasonCode: 'SHIPMENT_RETURNED' },
        error: new InvalidStateTransitionError('SHIPPED', 'restock the return'),
      },
      {
        setUp: setUp(cancelled),
        input: {
          orderId: cancelled.id,
          reasonCode: 'ORDER_CANCELLED',
          lineId: newId<'OrderLine'>(),
        },
        error: UnknownOrderLineError,
      },
    ] as const;

    for (const {
      setUp: { restocks, restocked, audited },
      input,
      error,
    } of cases) {
      await expect(
        restocks.restock({
          orderId: input.orderId as OrderId,
          reasonCode: input.reasonCode,
          lines: [
            {
              orderLineId:
                'lineId' in input ? input.lineId : paid.snapshot.lines[0].id,
              quantity: 1,
            },
          ],
          note: null,
          actorId: staff,
        }),
      ).rejects.toThrow(error);
      expect([restocked, audited]).toEqual([[], []]);
    }
  });
});
