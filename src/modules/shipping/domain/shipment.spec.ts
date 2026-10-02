import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
} from '../../../shared-kernel/index.js';
import {
  Shipment,
  type ShipmentAddress,
  type ShipmentStatus,
} from './shipment.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');

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

const item = (quantity = 2) => ({
  orderLineId: newId<'OrderLine'>(),
  sku: 'CAM-M',
  productName: 'Camisa de lino',
  quantity,
});

const create = (items = [item()]) =>
  Shipment.create({
    id: newId<'Shipment'>(),
    orderId: newId<'Order'>(),
    orderCode: 'K7M4Q9XA',
    warehouseId: newId<'Warehouse'>(),
    destination: ADDRESS,
    items,
  });

/** A saved shipment in `status`, at version 3. */
const saved = (
  status: ShipmentStatus,
  tracking: { carrierName?: string; ownDelivery?: boolean } = {},
) =>
  Shipment.restore({
    ...create().snapshot,
    status,
    carrierName: tracking.carrierName ?? null,
    trackingNumber: tracking.carrierName === undefined ? null : '8055123456',
    ownDelivery: tracking.ownDelivery ?? false,
    dispatchedAt: status === 'PENDING' ? null : NOW,
    version: 3,
  });

describe('Shipment (UC-SHI-03 and 04, BR-SHP-01 to 05, ADR-0140)', () => {
  it('is created PENDING for the address and every line of its order, without carrier', () => {
    const lines = [item(2), item(1)];
    const shipment = create(lines);

    expect(shipment.snapshot).toMatchObject({
      orderCode: 'K7M4Q9XA',
      status: 'PENDING',
      destination: ADDRESS,
      items: lines,
      carrierName: null,
      trackingNumber: null,
      ownDelivery: false,
      dispatchedAt: null,
      cancelledAt: null,
      version: 1,
    });
    expect(shipment.hasChanges).toBe(true);
  });

  it('carries at least one item, each of a whole number of units above zero', () => {
    for (const items of [[], [item(0)], [item(1.5)], [item(-1)]]) {
      expect(() => create(items)).toThrow(InvalidValueError);
    }
  });

  it('keeps what was saved until something changes', () => {
    const shipment = saved('PENDING');

    expect([shipment.hasChanges, shipment.version, shipment.status]).toEqual([
      false,
      3,
      'PENDING',
    ]);
  });

  it('records the carrier and the tracking number while pending, and again once dispatched by a carrier', () => {
    for (const shipment of [
      saved('PENDING'),
      saved('DISPATCHED', { carrierName: 'DHL' }),
    ]) {
      expect(shipment.recordTracking('Estafeta', 'EST-0001')).toBe(true);

      expect(shipment.snapshot).toMatchObject({
        carrierName: 'Estafeta',
        trackingNumber: 'EST-0001',
      });
      expect(shipment.hasChanges).toBe(true);
    }
  });

  it('changes nothing when the carrier and the tracking number are the ones it has', () => {
    const shipment = saved('PENDING', { carrierName: 'Estafeta' });

    expect(shipment.recordTracking('Estafeta', '8055123456')).toBe(false);
    expect(shipment.recordTracking('Estafeta', '8055123457')).toBe(true);
    expect(
      saved('PENDING', { carrierName: 'Estafeta' }).recordTracking(
        'DHL',
        '8055123456',
      ),
    ).toBe(true);
    expect(saved('PENDING', { carrierName: 'Estafeta' }).hasChanges).toBe(
      false,
    );
  });

  it('records no tracking in a shipment delivered by the store, nor after it was delivered, failed, returned or cancelled (ADR-0078)', () => {
    for (const shipment of [
      saved('DISPATCHED', { ownDelivery: true }),
      saved('DELIVERED', { carrierName: 'DHL' }),
      saved('DELIVERY_FAILED', { carrierName: 'DHL' }),
      saved('RETURNED', { carrierName: 'DHL' }),
      saved('CANCELLED'),
    ]) {
      expect(() => shipment.recordTracking('Estafeta', 'EST-0001')).toThrow(
        new InvalidStateTransitionError(shipment.status, 'record the tracking'),
      );
      expect(shipment.hasChanges).toBe(false);
    }
  });

  it('is cancelled with its order only while pending, and keeps when (ADR-0140)', () => {
    const shipment = saved('PENDING');

    shipment.cancel(NOW);

    expect(shipment.snapshot).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: NOW,
    });
    expect(shipment.hasChanges).toBe(true);
    for (const status of [
      'DISPATCHED',
      'DELIVERED',
      'DELIVERY_FAILED',
      'RETURNED',
      'CANCELLED',
    ] as const) {
      const other = saved(status, { carrierName: 'DHL' });
      expect(() => other.cancel(NOW)).toThrow(
        new InvalidStateTransitionError(status, 'cancel'),
      );
    }
  });
});
