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
import {
  InsufficientStockError,
  RestockLimitError,
  type StockMovement,
  type VariantId,
} from '../domain/stock.js';
import {
  type RestockEntry,
  StockLedgerRepository,
} from '../domain/stock-ledger.repository.js';
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
    private readonly committed = false,
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

  isCommitted(): Promise<boolean> {
    return Promise.resolve(this.committed);
  }
}

/** The ledger in memory: what each line restocked before, and the restocks it writes. */
class FakeLedger extends StockLedgerRepository {
  readonly written: RestockEntry[] = [];
  readonly asked: string[][] = [];

  constructor(
    private readonly before: ReadonlyMap<string, number> = new Map(),
  ) {
    super();
  }

  receive(): never {
    throw new Error('not used');
  }

  adjust(): never {
    throw new Error('not used');
  }

  restock(entries: readonly RestockEntry[]): Promise<StockMovement[]> {
    this.written.push(...entries);
    return Promise.resolve(
      entries.map((entry) => ({
        id: entry.movementId,
        stockItemId: newId<'StockItem'>(),
        type: 'RESTOCK' as const,
        quantity: entry.quantity,
        onHandAfter: 10,
        reasonCode: entry.reasonCode,
        note: entry.note,
        orderId: entry.orderId,
        orderLineId: entry.orderLineId,
        actorId: entry.actorId,
        createdAt: entry.at,
      })),
    );
  }

  restockedOf(ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    this.asked.push([...ids]);
    return Promise.resolve(
      new Map([...this.before].filter(([id]) => ids.includes(id))),
    );
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
  ledger: StockLedgerRepository = new FakeLedger(),
) =>
  new InventoryFacade(
    reservations,
    ledger,
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

  describe('restock (UC-INV-09, ADR-0052, ADR-0142)', () => {
    const actorId = newId<'User'>();
    const [first, second] = [newId<'OrderLine'>(), newId<'OrderLine'>()];

    /** A facade whose order had its stock confirmed, or not, and whose lines restocked `before`. */
    const restocking = (
      committed: boolean,
      before = new Map<string, number>(),
    ) => {
      const ledger = new FakeLedger(before);
      return {
        ledger,
        facade: facade(
          new FakeReservations(null, [], committed),
          undefined,
          true,
          ledger,
        ),
      };
    };

    it('brings each line back to the active warehouse with its reason, order, line, note and staff member', async () => {
      const { facade: inventory, ledger } = restocking(true);

      const movements = await inventory.restock({
        orderId,
        reasonCode: 'SHIPMENT_RETURNED',
        note: '  Caja sin abrir  ',
        actorId,
        lines: [
          { orderLineId: first, variantId: shirt, sold: 2, quantity: 2 },
          { orderLineId: second, variantId: cap, sold: 1, quantity: 1 },
        ],
      });

      expect(ledger.written).toEqual([
        {
          movementId: expect.any(String),
          warehouseId,
          variantId: shirt,
          quantity: 2,
          note: 'Caja sin abrir',
          actorId,
          at: NOW,
          reasonCode: 'SHIPMENT_RETURNED',
          orderId,
          orderLineId: first,
        },
        expect.objectContaining({
          variantId: cap,
          quantity: 1,
          orderLineId: second,
        }),
      ]);
      expect(movements.map(({ id }) => id)).toEqual(
        ledger.written.map(({ movementId }) => movementId),
      );
      expect(ledger.asked).toEqual([[first, second]]);
    });

    it('never brings a line back beyond what it sold, adding up what it restocked before', async () => {
      const { facade: inventory, ledger } = restocking(
        true,
        new Map([[first, 1]]),
      );

      await expect(
        inventory.restock({
          orderId,
          reasonCode: 'ORDER_CANCELLED',
          note: null,
          actorId,
          lines: [
            { orderLineId: first, variantId: shirt, sold: 2, quantity: 2 },
            { orderLineId: second, variantId: cap, sold: 1, quantity: 2 },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'restock-not-allowed',
        details: {
          lines: [
            { orderLineId: first, sold: 2, restocked: 1, requested: 2 },
            { orderLineId: second, sold: 1, restocked: 0, requested: 2 },
          ],
        },
      });
      expect(ledger.written).toEqual([]);
      const { facade: exact, ledger: written } = restocking(
        true,
        new Map([[first, 1]]),
      );
      await exact.restock({
        orderId,
        reasonCode: 'ORDER_CANCELLED',
        note: null,
        actorId,
        lines: [{ orderLineId: first, variantId: shirt, sold: 2, quantity: 1 }],
      });
      expect(written.written).toHaveLength(1);
    });

    it('counts nothing sold for an order whose stock was never confirmed', async () => {
      const { facade: inventory, ledger } = restocking(false);
      let thrown: unknown;

      try {
        await inventory.restock({
          orderId,
          reasonCode: 'ORDER_CANCELLED',
          note: null,
          actorId,
          lines: [
            { orderLineId: first, variantId: shirt, sold: 2, quantity: 1 },
          ],
        });
      } catch (error) {
        thrown = error;
      }

      expect((thrown as RestockLimitError).details).toEqual({
        lines: [{ orderLineId: first, sold: 0, restocked: 0, requested: 1 }],
      });
      expect(ledger.written).toEqual([]);
    });

    it('rejects no lines, a line twice and a quantity that is not a whole number above zero, asking nothing', async () => {
      const { facade: inventory, ledger } = restocking(true);
      const line = { orderLineId: first, variantId: shirt, sold: 5 };

      for (const lines of [
        [],
        [
          { ...line, quantity: 1 },
          { ...line, quantity: 1 },
        ],
        [{ ...line, quantity: 0 }],
        [{ ...line, quantity: 1.5 }],
      ]) {
        await expect(
          inventory.restock({
            orderId,
            reasonCode: 'ORDER_CANCELLED',
            note: null,
            actorId,
            lines,
          }),
        ).rejects.toThrow(InvalidValueError);
      }
      expect([ledger.asked, ledger.written]).toEqual([[], []]);
    });
  });
});
