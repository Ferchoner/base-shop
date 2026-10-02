import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
} from '../../../shared-kernel/index.js';
import {
  DispatchTrackingError,
  Shipment,
  type ShipmentAddress,
  type ShipmentStatus,
} from './shipment.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const LATER = new Date('2026-10-03T09:30:00.000Z');

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

describe('Shipment on its way (UC-SHI-05 to 07 and 09, BR-SHP-03, 04 and 09, ADR-0053, ADR-0078, ADR-0141)', () => {
  /** Every status but these. */
  const besides = (...allowed: ShipmentStatus[]) =>
    (
      [
        'PENDING',
        'DISPATCHED',
        'DELIVERED',
        'DELIVERY_FAILED',
        'RETURNED',
        'CANCELLED',
      ] as const
    ).filter((status) => !allowed.includes(status));

  it('removes a carrier and tracking number recorded by mistake while pending, and nothing when it has none', () => {
    const shipment = saved('PENDING', { carrierName: 'Estafeta' });

    expect(shipment.removeTracking()).toBe(true);

    expect(shipment.snapshot).toMatchObject({
      carrierName: null,
      trackingNumber: null,
    });
    expect(shipment.hasChanges).toBe(true);
    const untracked = saved('PENDING');
    expect(untracked.removeTracking()).toBe(false);
    expect(untracked.hasChanges).toBe(false);
  });

  it('keeps the carrier and tracking number of a shipment that is no longer pending', () => {
    for (const status of besides('PENDING')) {
      const shipment = saved(status, { carrierName: 'DHL' });

      expect(() => shipment.removeTracking()).toThrow(
        new InvalidStateTransitionError(status, 'remove the tracking'),
      );
      expect(shipment.snapshot.carrierName).toBe('DHL');
    }
  });

  it('leaves by a carrier with its carrier and tracking number, or as own delivery without them', () => {
    const byCarrier = saved('PENDING', { carrierName: 'Estafeta' });
    const ownDelivery = saved('PENDING');

    byCarrier.dispatch(false, NOW);
    ownDelivery.dispatch(true, LATER);

    expect(byCarrier.snapshot).toMatchObject({
      status: 'DISPATCHED',
      carrierName: 'Estafeta',
      trackingNumber: '8055123456',
      ownDelivery: false,
      dispatchedAt: NOW,
    });
    expect(ownDelivery.snapshot).toMatchObject({
      status: 'DISPATCHED',
      carrierName: null,
      trackingNumber: null,
      ownDelivery: true,
      dispatchedAt: LATER,
    });
    expect([byCarrier.hasChanges, ownDelivery.hasChanges]).toEqual([
      true,
      true,
    ]);
  });

  it('does not leave by a carrier without its tracking, nor as own delivery with it (BR-SHP-04)', () => {
    const untracked = saved('PENDING');
    const tracked = saved('PENDING', { carrierName: 'Estafeta' });
    const carrierOnly = Shipment.restore({
      ...saved('PENDING', { carrierName: 'Estafeta' }).snapshot,
      trackingNumber: null,
    });

    expect(() => untracked.dispatch(false, NOW)).toThrow(
      new DispatchTrackingError('trackingRequired'),
    );
    expect(() => carrierOnly.dispatch(false, NOW)).toThrow(
      new DispatchTrackingError('trackingRequired'),
    );
    expect(() => tracked.dispatch(true, NOW)).toThrow(
      new DispatchTrackingError('trackingNotAllowed'),
    );

    expect([untracked.status, tracked.status]).toEqual(['PENDING', 'PENDING']);
    expect([untracked.hasChanges, tracked.hasChanges]).toEqual([false, false]);
    expect(new DispatchTrackingError('trackingRequired').details).toEqual({
      errors: [
        expect.objectContaining({
          field: 'ownDelivery',
          code: 'trackingRequired',
        }),
      ],
    });
    expect(new DispatchTrackingError('trackingNotAllowed').details).toEqual({
      errors: [
        expect.objectContaining({
          field: 'ownDelivery',
          code: 'trackingNotAllowed',
        }),
      ],
    });
  });

  it('leaves only once, from pending, whatever its tracking', () => {
    for (const status of besides('PENDING')) {
      for (const shipment of [
        saved(status),
        saved(status, { carrierName: 'DHL' }),
      ]) {
        expect(() => shipment.dispatch(false, NOW)).toThrow(
          new InvalidStateTransitionError(status, 'dispatch'),
        );
        expect(() => shipment.dispatch(true, NOW)).toThrow(
          new InvalidStateTransitionError(status, 'dispatch'),
        );
      }
    }
  });

  it('is delivered once dispatched, for good (BR-SHP-03)', () => {
    const shipment = saved('DISPATCHED', { carrierName: 'DHL' });

    shipment.deliver(LATER);

    expect(shipment.snapshot).toMatchObject({
      status: 'DELIVERED',
      dispatchedAt: NOW,
      deliveredAt: LATER,
    });
    expect(shipment.hasChanges).toBe(true);
    for (const status of besides('DISPATCHED')) {
      expect(() => saved(status).deliver(LATER)).toThrow(
        new InvalidStateTransitionError(status, 'deliver'),
      );
    }
  });

  it('fails its delivery once dispatched, with the note of the staff or without one (ADR-0053)', () => {
    const noted = saved('DISPATCHED', { carrierName: 'DHL' });
    const unnoted = saved('DISPATCHED', { ownDelivery: true });

    noted.failDelivery('Nadie recibió el paquete', LATER);
    unnoted.failDelivery(null, LATER);

    expect(noted.snapshot).toMatchObject({
      status: 'DELIVERY_FAILED',
      failedAt: LATER,
      failureNote: 'Nadie recibió el paquete',
      deliveredAt: null,
    });
    expect(unnoted.snapshot).toMatchObject({
      status: 'DELIVERY_FAILED',
      failedAt: LATER,
      failureNote: null,
    });
    expect(noted.hasChanges).toBe(true);
    for (const status of besides('DISPATCHED')) {
      expect(() => saved(status).failDelivery(null, LATER)).toThrow(
        new InvalidStateTransitionError(status, 'record the delivery failure'),
      );
    }
  });

  it('comes back only after a failed delivery, for good, keeping why it failed (ADR-0053)', () => {
    const shipment = saved('DISPATCHED', { carrierName: 'DHL' });
    shipment.failDelivery('Dirección incompleta', NOW);

    shipment.markReturned('Caja sin abrir', LATER);

    expect(shipment.snapshot).toMatchObject({
      status: 'RETURNED',
      failedAt: NOW,
      failureNote: 'Dirección incompleta',
      returnedAt: LATER,
      returnNote: 'Caja sin abrir',
    });
    const unnoted = saved('DELIVERY_FAILED', { carrierName: 'DHL' });
    unnoted.markReturned(null, LATER);
    expect(unnoted.snapshot.returnNote).toBeNull();
    for (const status of besides('DELIVERY_FAILED')) {
      expect(() => saved(status).markReturned(null, LATER)).toThrow(
        new InvalidStateTransitionError(status, 'mark returned'),
      );
    }
  });
});
