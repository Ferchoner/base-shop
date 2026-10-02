import {
  type AuditEntry,
  type AuditTrail,
  type DomainEvent,
  type DomainEventPublisher,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  type TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  DispatchTrackingError,
  Shipment,
  type ShipmentAddress,
  type ShipmentId,
  type ShipmentStatus,
} from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';
import { ShipmentDelivery } from './shipment-delivery.use-case.js';

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

const DISPATCHED = new Date('2026-10-02T12:00:00.000Z');
const NOW = new Date('2026-10-03T09:30:00.000Z');

/**
 * A saved shipment in `status`, at version 2: with Estafeta as its carrier unless `ownDelivery`, and dispatched
 * unless pending.
 */
const saved = (status: ShipmentStatus, ownDelivery = false) =>
  Shipment.restore({
    ...Shipment.create({
      id: newId<'Shipment'>(),
      orderId: newId<'Order'>(),
      orderCode: 'K7M4Q9XA',
      warehouseId: newId<'Warehouse'>(),
      destination: ADDRESS,
      items: [
        {
          orderLineId: newId<'OrderLine'>(),
          sku: 'CAM-M',
          productName: 'Camisa de lino',
          quantity: 1,
        },
      ],
    }).snapshot,
    status,
    carrierName: ownDelivery ? null : 'Estafeta',
    trackingNumber: ownDelivery ? null : 'EST-0001',
    ownDelivery: ownDelivery && status !== 'PENDING',
    dispatchedAt: status === 'PENDING' ? null : DISPATCHED,
    version: 2,
  });

class OneShipment extends ShipmentRepository {
  readonly saved: Shipment[] = [];

  constructor(private readonly shipment: Shipment) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('A shipment on its way is never created again');
  }

  lock(id: ShipmentId): Promise<Shipment | null> {
    return Promise.resolve(id === this.shipment.id ? this.shipment : null);
  }

  lockByOrder(): Promise<Shipment | null> {
    throw new Error('The staff finds the shipment by its ID');
  }

  save(shipment: Shipment, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.saved.push(shipment);
    return Promise.resolve();
  }
}

function setUp(shipment: Shipment) {
  const shipments = new OneShipment(shipment);
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const published: DomainEvent[] = [];
  const events = {
    publish: (...batch: DomainEvent[]) => {
      published.push(...batch);
    },
  } as unknown as DomainEventPublisher;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const delivery = new ShipmentDelivery(shipments, inline, audit, events, {
    now: () => NOW,
  });
  return { delivery, shipments, audited, published };
}

describe('ShipmentDelivery (UC-SHI-05 to 07 and 09, ADR-0141)', () => {
  it('dispatches by a carrier, audited, and tells Ordering with its carrier and tracking number', async () => {
    const shipment = saved('PENDING');
    const { delivery, shipments, audited, published } = setUp(shipment);

    await delivery.dispatch({
      shipmentId: shipment.id,
      ownDelivery: false,
      version: 2,
    });

    expect(shipments.saved).toEqual([shipment]);
    expect(shipment.snapshot).toMatchObject({
      status: 'DISPATCHED',
      dispatchedAt: NOW,
    });
    expect(audited).toEqual([
      {
        action: 'shipments.dispatch',
        resource: { type: 'shipment', id: shipment.id },
        changes: { status: { from: 'PENDING', to: 'DISPATCHED' } },
      },
    ]);
    expect(published).toEqual([
      {
        eventId: expect.any(String),
        eventType: 'ShipmentDispatched',
        occurredAt: NOW,
        shipmentId: shipment.id,
        orderId: shipment.snapshot.orderId,
        carrierName: 'Estafeta',
        trackingNumber: 'EST-0001',
        ownDelivery: false,
      },
    ]);
  });

  it('dispatches as own delivery, which the audit and the event show (ADR-0078)', async () => {
    const shipment = saved('PENDING', true);
    const { delivery, audited, published } = setUp(shipment);

    await delivery.dispatch({
      shipmentId: shipment.id,
      ownDelivery: true,
      version: 2,
    });

    expect(audited[0].changes).toEqual({
      status: { from: 'PENDING', to: 'DISPATCHED' },
      ownDelivery: { from: false, to: true },
    });
    expect(published).toEqual([
      expect.objectContaining({
        eventType: 'ShipmentDispatched',
        carrierName: null,
        trackingNumber: null,
        ownDelivery: true,
      }),
    ]);
  });

  it('delivers, audited, and tells Ordering when it left and when it was delivered', async () => {
    const shipment = saved('DISPATCHED');
    const { delivery, shipments, audited, published } = setUp(shipment);

    await delivery.deliver({ shipmentId: shipment.id, version: 2 });

    expect(shipments.saved).toEqual([shipment]);
    expect(shipment.snapshot).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: NOW,
    });
    expect(audited).toEqual([
      {
        action: 'shipments.deliver',
        resource: { type: 'shipment', id: shipment.id },
        changes: { status: { from: 'DISPATCHED', to: 'DELIVERED' } },
      },
    ]);
    expect(published).toEqual([
      {
        eventId: expect.any(String),
        eventType: 'ShipmentDelivered',
        occurredAt: NOW,
        shipmentId: shipment.id,
        orderId: shipment.snapshot.orderId,
        dispatchedAt: DISPATCHED,
      },
    ]);
  });

  it('records a failed delivery and the return with their notes as the reason of the audit, and tells no one (ADR-0053)', async () => {
    const failed = saved('DISPATCHED', true);
    const returned = saved('DELIVERY_FAILED');
    const failing = setUp(failed);
    const returning = setUp(returned);

    await failing.delivery.failDelivery({
      shipmentId: failed.id,
      note: 'Nadie recibió el paquete',
      version: 2,
    });
    await returning.delivery.markReturned({
      shipmentId: returned.id,
      note: 'Caja sin abrir',
      version: 2,
    });

    expect(failed.snapshot).toMatchObject({
      status: 'DELIVERY_FAILED',
      failedAt: NOW,
      failureNote: 'Nadie recibió el paquete',
    });
    expect(returned.snapshot).toMatchObject({
      status: 'RETURNED',
      returnedAt: NOW,
      returnNote: 'Caja sin abrir',
    });
    expect([...failing.audited, ...returning.audited]).toEqual([
      {
        action: 'shipments.delivery-failure',
        resource: { type: 'shipment', id: failed.id },
        changes: { status: { from: 'DISPATCHED', to: 'DELIVERY_FAILED' } },
        reason: 'Nadie recibió el paquete',
      },
      {
        action: 'shipments.return',
        resource: { type: 'shipment', id: returned.id },
        changes: { status: { from: 'DELIVERY_FAILED', to: 'RETURNED' } },
        reason: 'Caja sin abrir',
      },
    ]);
    expect([failing.shipments.saved, returning.shipments.saved]).toEqual([
      [failed],
      [returned],
    ]);
    expect([failing.published, returning.published]).toEqual([[], []]);
  });

  it('audits without a reason when there is no note', async () => {
    const failed = saved('DISPATCHED');
    const returned = saved('DELIVERY_FAILED');
    const failing = setUp(failed);
    const returning = setUp(returned);

    await failing.delivery.failDelivery({
      shipmentId: failed.id,
      note: null,
      version: 2,
    });
    await returning.delivery.markReturned({
      shipmentId: returned.id,
      note: null,
      version: 2,
    });

    for (const entry of [...failing.audited, ...returning.audited]) {
      expect(entry).not.toHaveProperty('reason');
    }
    expect([failed.snapshot.failureNote, returned.snapshot.returnNote]).toEqual(
      [null, null],
    );
  });

  it('checks the shipment, then its version, then its status and its tracking, changing and telling nothing', async () => {
    const pending = saved('PENDING');
    const untracked = saved('PENDING', true);
    const delivered = saved('DELIVERED');
    const missing = setUp(pending);
    const outdated = setUp(pending);
    const notPending = setUp(delivered);
    const withoutTracking = setUp(untracked);

    await expect(
      missing.delivery.deliver({ shipmentId: newId<'Shipment'>(), version: 2 }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      outdated.delivery.dispatch({
        shipmentId: pending.id,
        ownDelivery: false,
        version: 1,
      }),
    ).rejects.toThrow(new VersionConflictError(2));
    await expect(
      notPending.delivery.dispatch({
        shipmentId: delivered.id,
        ownDelivery: false,
        version: 2,
      }),
    ).rejects.toThrow(new InvalidStateTransitionError('DELIVERED', 'dispatch'));
    await expect(
      withoutTracking.delivery.dispatch({
        shipmentId: untracked.id,
        ownDelivery: false,
        version: 2,
      }),
    ).rejects.toThrow(new DispatchTrackingError('trackingRequired'));

    for (const { shipments, audited, published } of [
      missing,
      outdated,
      notPending,
      withoutTracking,
    ]) {
      expect([shipments.saved, audited, published]).toEqual([[], [], []]);
    }
  });
});
