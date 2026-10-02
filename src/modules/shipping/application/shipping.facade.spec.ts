import {
  type Clock,
  Money,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';
import {
  type OrderId,
  Shipment,
  type ShipmentAddress,
  type ShipmentStatus,
} from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';
import { ShippingMethod } from '../domain/shipping-method.js';
import { ShippingMethodRepository } from '../domain/shipping-method.repository.js';
import { ShippingFacade } from './shipping.facade.js';
import type { ShippingQueries } from './shipping.queries.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

/** A repository with the given active method, or none. */
class FixedMethod extends ShippingMethodRepository {
  constructor(private readonly method: ShippingMethod | null) {
    super();
  }

  findActive(): Promise<ShippingMethod | null> {
    return Promise.resolve(this.method);
  }

  save(): Promise<void> {
    return Promise.reject(new Error('not used'));
  }
}

/** A facade that only quotes: its shipments are never touched. */
const quoting = (method: ShippingMethod | null) =>
  new ShippingFacade(
    new FixedMethod(method),
    {} as ShipmentRepository,
    {} as ShippingQueries,
    {} as TransactionManager,
    {} as Clock,
    1_600,
  );

describe('ShippingFacade (UC-SHI-01, ADR-0122)', () => {
  const id = newId<'ShippingMethod'>();
  const standard = ShippingMethod.restore({
    id,
    name: 'Envío Estándar',
    flatFee: mxn(9_900),
    freeShippingThreshold: mxn(150_000),
    deliveryMinBusinessDays: 3,
    deliveryMaxBusinessDays: 7,
    isActive: true,
    version: 1,
  });

  it('quotes the shipping of an order with the active method and the configured VAT rate', async () => {
    const facade = quoting(standard);

    expect(
      await facade.quote({ subtotal: mxn(119_800), discount: mxn(0) }),
    ).toEqual({
      methodId: id,
      cost: mxn(9_900),
      taxAmount: mxn(1_366),
      taxRateBp: 1_600,
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
    });
  });

  it('still shows the threshold and the delivery time when shipping is free', async () => {
    const facade = quoting(standard);

    expect(
      await facade.quote({ subtotal: mxn(150_000), discount: mxn(0) }),
    ).toMatchObject({
      cost: mxn(0),
      taxAmount: mxn(0),
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
    });
  });

  it('fails loudly without an active method, which the migration always creates', async () => {
    const facade = quoting(null);

    await expect(
      facade.quote({ subtotal: mxn(100), discount: mxn(0) }),
    ).rejects.toThrow('There is no active shipping method');
  });
});

const ADDRESS: ShipmentAddress = {
  recipientName: 'María López',
  phone: '4431234567',
  street: 'Av. Madero',
  exteriorNumber: '123',
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

const NOW = new Date('2026-10-02T12:00:00.000Z');

/** Shipments in memory, by order; it remembers what it inserted and saved. */
class InMemoryShipments extends ShipmentRepository {
  readonly inserted: Shipment[] = [];
  readonly saved: Shipment[] = [];

  constructor(private readonly existing: Shipment | null = null) {
    super();
  }

  insert(shipment: Shipment, now: Date): Promise<boolean> {
    expect(now).toBe(NOW);
    this.inserted.push(shipment);
    return Promise.resolve(true);
  }

  lock(): Promise<Shipment | null> {
    throw new Error('The facade finds shipments by their order');
  }

  lockByOrder(orderId: OrderId): Promise<Shipment | null> {
    return Promise.resolve(
      this.existing?.snapshot.orderId === orderId ? this.existing : null,
    );
  }

  save(shipment: Shipment, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.saved.push(shipment);
    return Promise.resolve();
  }
}

describe('ShippingFacade: the shipment of an order (UC-SHI-03, ADR-0140)', () => {
  const orderId = newId<'Order'>();
  const items = [
    {
      orderLineId: newId<'OrderLine'>(),
      sku: 'CAM-M',
      productName: 'Camisa de lino',
      quantity: 2,
    },
  ];

  function setUp(existing: Shipment | null = null) {
    const shipments = new InMemoryShipments(existing);
    const asked: unknown[] = [];
    const queries = {
      shipmentsOf: (ids: readonly string[]) => {
        asked.push(ids);
        return Promise.resolve(new Map());
      },
    } as unknown as ShippingQueries;
    const inline = {
      run: <T>(work: () => Promise<T>) => work(),
    } as unknown as TransactionManager;
    const facade = new ShippingFacade(
      new FixedMethod(null),
      shipments,
      queries,
      inline,
      { now: () => NOW },
      1_600,
    );
    return { facade, shipments, asked };
  }

  const saved = (status: ShipmentStatus) =>
    Shipment.restore({
      ...Shipment.create({
        id: newId<'Shipment'>(),
        orderId,
        orderCode: 'K7M4Q9XA',
        warehouseId: newId<'Warehouse'>(),
        destination: ADDRESS,
        items,
      }).snapshot,
      status,
      carrierName: status === 'PENDING' ? null : 'DHL',
      trackingNumber: status === 'PENDING' ? null : '8055123456',
      dispatchedAt: status === 'PENDING' ? null : NOW,
    });

  it('creates a pending shipment of the order with a new ID', async () => {
    const { facade, shipments } = setUp();
    const warehouseId = newId<'Warehouse'>();

    await facade.createShipment({
      orderId,
      orderCode: 'K7M4Q9XA',
      warehouseId,
      destination: ADDRESS,
      items,
    });

    expect(shipments.inserted).toHaveLength(1);
    expect(shipments.inserted[0].snapshot).toMatchObject({
      orderId,
      orderCode: 'K7M4Q9XA',
      warehouseId,
      status: 'PENDING',
      destination: ADDRESS,
      items,
    });
  });

  it('creates no shipment without items', async () => {
    const { facade, shipments } = setUp();

    await expect(
      facade.createShipment({
        orderId,
        orderCode: 'K7M4Q9XA',
        warehouseId: newId<'Warehouse'>(),
        destination: ADDRESS,
        items: [],
      }),
    ).rejects.toThrow(InvalidValueError);
    expect(shipments.inserted).toEqual([]);
  });

  it('cancels the pending shipment of a cancelled order, and does nothing for an order without one', async () => {
    const pending = saved('PENDING');
    const withShipment = setUp(pending);
    const without = setUp();

    await withShipment.facade.cancelShipmentOf(orderId);
    await without.facade.cancelShipmentOf(orderId);

    expect(withShipment.shipments.saved.map(({ status }) => status)).toEqual([
      'CANCELLED',
    ]);
    expect(pending.snapshot.cancelledAt).toBe(NOW);
    expect(without.shipments.saved).toEqual([]);
  });

  it('does not cancel a shipment that left', async () => {
    const { facade, shipments } = setUp(saved('DISPATCHED'));

    await expect(facade.cancelShipmentOf(orderId)).rejects.toThrow(
      new InvalidStateTransitionError('DISPATCHED', 'cancel'),
    );
    expect(shipments.saved).toEqual([]);
  });

  it('reads the shipments of some orders', async () => {
    const { facade, asked } = setUp();

    await facade.shipmentsOf([orderId]);

    expect(asked).toEqual([[orderId]]);
  });
});
