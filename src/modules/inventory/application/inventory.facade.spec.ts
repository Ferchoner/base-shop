import {
  InvalidValueError,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  CommitOutcome,
  OrderId,
  ReservationId,
  ReservationReceipt,
  StockRequest,
} from '../domain/reservation.js';
import { ReservationRepository } from '../domain/reservation.repository.js';
import { InsufficientStockError, type VariantId } from '../domain/stock.js';
import { Warehouse, type WarehouseId } from '../domain/warehouse.js';
import { WarehouseRepository } from '../domain/warehouse.repository.js';
import { InventoryFacade } from './inventory.facade.js';
import type { InventoryQueries } from './inventory.queries.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const warehouseId = newId<'Warehouse'>();
const [shirt, cap, unstocked] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];

class OneWarehouse extends WarehouseRepository {
  constructor(private readonly active: boolean) {
    super();
  }

  find(): Promise<Warehouse | null> {
    return Promise.reject(new Error('not used'));
  }

  findActive(): Promise<Warehouse | null> {
    return Promise.resolve(
      this.active
        ? Warehouse.restore({
            id: warehouseId,
            code: 'PRINCIPAL',
            name: 'Almacén principal',
            address: null,
            status: 'ACTIVE',
          })
        : null,
    );
  }

  save(): Promise<void> {
    return Promise.reject(new Error('not used'));
  }
}

/** Reservations in memory: an order may already have one; `short` variants cannot be reserved. */
class FakeReservations extends ReservationRepository {
  readonly reserved: { warehouseId: WarehouseId; requests: StockRequest[] }[] =
    [];
  opened: { orderId: OrderId; expiresAt: Date } | null = null;

  constructor(
    private readonly existing: ReservationReceipt | null = null,
    private readonly short: readonly VariantId[] = [],
  ) {
    super();
  }

  open(reservation: {
    id: ReservationId;
    orderId: OrderId;
    expiresAt: Date;
  }): Promise<{ opened: boolean; receipt: ReservationReceipt }> {
    if (this.existing !== null) {
      return Promise.resolve({ opened: false, receipt: this.existing });
    }
    this.opened = reservation;
    return Promise.resolve({
      opened: true,
      receipt: {
        reservationId: reservation.id,
        orderId: reservation.orderId,
        expiresAt: reservation.expiresAt,
      },
    });
  }

  reserve(
    _id: ReservationId,
    reservedIn: WarehouseId,
    requests: readonly StockRequest[],
  ): Promise<VariantId[]> {
    this.reserved.push({ warehouseId: reservedIn, requests: [...requests] });
    return Promise.resolve(
      requests
        .map(({ variantId }) => variantId)
        .filter((variantId) => this.short.includes(variantId)),
    );
  }

  commit(): Promise<CommitOutcome> {
    return Promise.resolve('committed');
  }

  release(): Promise<boolean> {
    return Promise.resolve(true);
  }

  expire(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Available units by variant; it remembers what it was asked. */
function availability(units: ReadonlyMap<VariantId, number>) {
  const asked: VariantId[][] = [];
  const queries = {
    availableUnits: (_warehouse: WarehouseId, ids: readonly VariantId[]) => {
      asked.push([...ids]);
      return Promise.resolve(
        new Map([...units].filter(([id]) => ids.includes(id))),
      );
    },
  } as unknown as InventoryQueries;
  return { queries, asked };
}

const inline = {
  run: <T>(work: () => Promise<T>) => work(),
  runNested: <T>(work: () => Promise<T>) => work(),
} as unknown as TransactionManager;

const facade = (
  reservations: FakeReservations,
  queries: InventoryQueries = availability(new Map()).queries,
  active = true,
) =>
  new InventoryFacade(
    reservations,
    new OneWarehouse(active),
    queries,
    inline,
    { now: () => NOW },
    20 * 60,
  );

describe('InventoryFacade (UC-INV-05 to 07, ADR-0128)', () => {
  const orderId = newId<'Order'>();

  describe('canFulfill', () => {
    it('answers per variant whether the units asked for, added up, are available, and never the units', async () => {
      const { queries, asked } = availability(
        new Map([
          [shirt, 5],
          [cap, 0],
        ]),
      );

      const answer = await facade(new FakeReservations(), queries).canFulfill([
        { variantId: shirt, quantity: 3 },
        { variantId: cap, quantity: 1 },
        { variantId: shirt, quantity: 2 },
        { variantId: unstocked, quantity: 1 },
      ]);

      expect(answer).toEqual(
        new Map([
          [shirt, true],
          [cap, false],
          [unstocked, false],
        ]),
      );
      expect(asked).toEqual([[shirt, cap, unstocked]]);
      expect(
        (
          await facade(new FakeReservations(), queries).canFulfill([
            { variantId: shirt, quantity: 6 },
          ])
        ).get(shirt),
      ).toBe(false);
    });

    it('asks nothing for no requests', async () => {
      const { queries, asked } = availability(new Map());

      expect(
        await facade(new FakeReservations(), queries).canFulfill([]),
      ).toEqual(new Map());
      expect(asked).toEqual([]);
    });
  });

  describe('reserve', () => {
    it('opens a reservation until the TTL passes and reserves every request, added up, in the active warehouse', async () => {
      const reservations = new FakeReservations();

      const receipt = await facade(reservations).reserve(orderId, [
        { variantId: shirt, quantity: 1 },
        { variantId: shirt, quantity: 2 },
      ]);

      expect(receipt).toMatchObject({
        orderId,
        expiresAt: new Date('2026-10-01T12:20:00.000Z'),
      });
      expect(reservations.reserved).toEqual([
        { warehouseId, requests: [{ variantId: shirt, quantity: 3 }] },
      ]);
    });

    it('answers the reservation the order already has without reserving again (BR-INV-04)', async () => {
      const existing: ReservationReceipt = {
        reservationId: newId(),
        orderId,
        expiresAt: NOW,
      };
      const reservations = new FakeReservations(existing);

      expect(
        await facade(reservations).reserve(orderId, [
          { variantId: shirt, quantity: 1 },
        ]),
      ).toBe(existing);
      expect(reservations.reserved).toEqual([]);
    });

    it('rejects the reservation with every variant that cannot be fulfilled (BR-INV-02)', async () => {
      const reservations = new FakeReservations(null, [cap, unstocked]);

      await expect(
        facade(reservations).reserve(orderId, [
          { variantId: shirt, quantity: 1 },
          { variantId: cap, quantity: 1 },
          { variantId: unstocked, quantity: 1 },
        ]),
      ).rejects.toThrow(new InsufficientStockError([cap, unstocked]));
    });

    it('rejects a reservation without requests', async () => {
      await expect(
        facade(new FakeReservations()).reserve(orderId, []),
      ).rejects.toThrow(InvalidValueError);
    });

    it('fails loudly without the warehouse the migration creates', async () => {
      await expect(
        facade(new FakeReservations(), undefined, false).reserve(orderId, [
          { variantId: shirt, quantity: 1 },
        ]),
      ).rejects.toThrow('There is no active warehouse');
    });
  });
});
