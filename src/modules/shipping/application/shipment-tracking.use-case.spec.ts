import {
  type AuditEntry,
  type AuditTrail,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  type TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  Shipment,
  type ShipmentAddress,
  type ShipmentId,
  type ShipmentStatus,
} from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';
import { ShipmentTracking } from './shipment-tracking.use-case.js';

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

/** A saved shipment in `status`, at version 2, with Estafeta as its carrier unless it is pending. */
const saved = (status: ShipmentStatus) =>
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
    carrierName: status === 'PENDING' ? null : 'Estafeta',
    trackingNumber: status === 'PENDING' ? null : 'EST-0001',
    dispatchedAt: status === 'PENDING' ? null : NOW,
    version: 2,
  });

class OneShipment extends ShipmentRepository {
  readonly saved: Shipment[] = [];

  constructor(private readonly shipment: Shipment) {
    super();
  }

  insert(): Promise<boolean> {
    throw new Error('Recording the tracking never creates a shipment');
  }

  lock(id: ShipmentId): Promise<Shipment | null> {
    return Promise.resolve(id === this.shipment.id ? this.shipment : null);
  }

  lockByOrder(): Promise<Shipment | null> {
    throw new Error('Recording the tracking finds the shipment by its ID');
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
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const tracking = new ShipmentTracking(shipments, inline, audit, {
    now: () => NOW,
  });
  return { tracking, shipments, audited };
}

const record = (
  tracking: ShipmentTracking,
  shipment: Shipment,
  changes: Partial<{
    shipmentId: ShipmentId;
    carrierName: string;
    trackingNumber: string;
    version: number;
  }> = {},
) =>
  tracking.record({
    shipmentId: shipment.id,
    carrierName: 'DHL',
    trackingNumber: 'DHL-0002',
    version: 2,
    ...changes,
  });

describe('ShipmentTracking (UC-SHI-04, ADR-0140)', () => {
  it('records the carrier and the tracking number, and audits the change', async () => {
    const shipment = saved('DISPATCHED');
    const { tracking, shipments, audited } = setUp(shipment);

    await record(tracking, shipment);

    expect(shipments.saved).toEqual([shipment]);
    expect(shipment.snapshot).toMatchObject({
      carrierName: 'DHL',
      trackingNumber: 'DHL-0002',
    });
    expect(audited).toEqual([
      {
        action: 'shipments.update',
        resource: { type: 'shipment', id: shipment.id },
        changes: {
          carrierName: { from: 'Estafeta', to: 'DHL' },
          trackingNumber: { from: 'EST-0001', to: 'DHL-0002' },
        },
      },
    ]);
  });

  it('saves and audits nothing when they are the ones it has', async () => {
    const shipment = saved('DISPATCHED');
    const { tracking, shipments, audited } = setUp(shipment);

    await record(tracking, shipment, {
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
    });

    expect([shipments.saved, audited]).toEqual([[], []]);
  });

  it('checks the shipment, then its version, then its status', async () => {
    const pending = saved('PENDING');
    const cancelled = saved('CANCELLED');
    const missing = setUp(pending);
    const outdated = setUp(pending);
    const notEditable = setUp(cancelled);

    await expect(
      record(missing.tracking, pending, { shipmentId: newId<'Shipment'>() }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      record(outdated.tracking, pending, { version: 1 }),
    ).rejects.toThrow(new VersionConflictError(2));
    await expect(record(notEditable.tracking, cancelled)).rejects.toThrow(
      new InvalidStateTransitionError('CANCELLED', 'record the tracking'),
    );
    for (const { shipments, audited } of [missing, outdated, notEditable]) {
      expect([shipments.saved, audited]).toEqual([[], []]);
    }
  });
});
