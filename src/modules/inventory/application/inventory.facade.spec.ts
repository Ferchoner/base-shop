import {
  InvalidValueError,
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Allocation, WarehouseStock } from '../domain/allocation.js';
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
const [warehouseId, backup] = [newId<'Warehouse'>(), newId<'Warehouse'>()];
const [shirt, cap, unstocked] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];

/** The first active warehouse by priority, or none. */
class FirstWarehouse extends WarehouseRepository {
  constructor(private readonly active: boolean) {
    super();
  }

  find(): Promise<Warehouse | null> {
    return Promise.reject(new Error('not used'));
  }

  firstActive(): Promise<Warehouse | null> {
    return Promise.resolve(
      this.active
        ? Warehouse.restore({
            id: warehouseId,
            code: 'PRINCIPAL',
            name: 'Almacén principal',
            address: null,
            status: 'ACTIVE',
            priority: 1,
          })
        : null,
    );
  }

  save(): Promise<void> {
    return Promise.reject(new Error('not used'));
  }
}

/**
 * Reservations in memory: an order may already have one; in each warehouse, the `short` variants cannot be
 * reserved, as when another order took them after they were read.
 */
class FakeReservations extends ReservationRepository {
  readonly reserved: { warehouseId: WarehouseId; requests: StockRequest[] }[] =
    [];
  opened: { orderId: OrderId; expiresAt: Date } | null = null;

  constructor(
    private readonly existing: ReservationReceipt | null = null,
    private readonly short: ReadonlyMap<
      WarehouseId,
      readonly VariantId[]
    > = new Map(),
    private readonly committed = false,
    private readonly allocation: Allocation[] = [],
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
    const short = this.short.get(reservedIn) ?? [];
    return Promise.resolve(
      requests
        .map(({ variantId }) => variantId)
        .filter((variantId) => short.includes(variantId)),
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

  allocationOf(): Promise<Allocation[]> {
    return Promise.resolve(this.allocation);
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

/** The active warehouses by priority, with their available units by variant; it remembers what it was asked. */
function availability(
  warehouses: readonly {
    id: WarehouseId;
    units: ReadonlyMap<VariantId, number>;
  }[],
) {
  const asked: VariantId[][] = [];
  const queries = {
    activeStock: (ids: readonly VariantId[]): Promise<WarehouseStock[]> => {
      asked.push([...ids]);
      return Promise.resolve(
        warehouses.map(({ id, units }) => ({
          warehouseId: id,
          available: new Map([...units].filter(([unit]) => ids.includes(unit))),
        })),
      );
    },
  } as unknown as InventoryQueries;
  return { queries, asked };
}

/** Both warehouses with plenty of everything but `unstocked`. */
const stocked = () =>
  availability([
    {
      id: warehouseId,
      units: new Map([
        [shirt, 10],
        [cap, 10],
      ]),
    },
    {
      id: backup,
      units: new Map([
        [shirt, 10],
        [cap, 10],
      ]),
    },
  ]);

/** Runs the work as is, counting the nested steps it opens. */
function inlineTransactions() {
  const steps = { nested: 0 };
  const transactions = {
    run: <T>(work: () => Promise<T>) => work(),
    runNested: <T>(work: () => Promise<T>) => {
      steps.nested += 1;
      return work();
    },
  } as unknown as TransactionManager;
  return { transactions, steps };
}

const facade = (
  reservations: FakeReservations,
  queries: InventoryQueries = stocked().queries,
  active = true,
  ledger: StockLedgerRepository = new FakeLedger(),
  transactions: TransactionManager = inlineTransactions().transactions,
) =>
  new InventoryFacade(
    reservations,
    ledger,
    new FirstWarehouse(active),
    queries,
    transactions,
    { now: () => NOW },
    20 * 60,
  );

describe('InventoryFacade (UC-INV-05 to 07, ADR-0128, ADR-0160)', () => {
  const orderId = newId<'Order'>();

  describe('canFulfill', () => {
    it('answers per variant whether some warehouse alone has the units asked for, added up, and never the units', async () => {
      const { queries, asked } = availability([
        {
          id: warehouseId,
          units: new Map([
            [shirt, 2],
            [cap, 0],
          ]),
        },
        { id: backup, units: new Map([[shirt, 5]]) },
      ]);

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
      const { queries, asked } = stocked();

      expect(
        await facade(new FakeReservations(), queries).canFulfill([]),
      ).toEqual(new Map());
      expect(
        await facade(new FakeReservations(), queries).canFulfillTogether([]),
      ).toEqual(new Map());
      expect(asked).toEqual([]);
    });
  });

  describe('canFulfillTogether', () => {
    it('answers every variant can when one warehouse holds all of them, even if not the first', async () => {
      const { queries } = availability([
        { id: warehouseId, units: new Map([[shirt, 5]]) },
        {
          id: backup,
          units: new Map([
            [shirt, 3],
            [cap, 1],
          ]),
        },
      ]);

      expect(
        await facade(new FakeReservations(), queries).canFulfillTogether([
          { variantId: shirt, quantity: 2 },
          { variantId: cap, quantity: 1 },
          { variantId: shirt, quantity: 1 },
        ]),
      ).toEqual(
        new Map([
          [shirt, true],
          [cap, true],
        ]),
      );
    });

    it('marks what the closest warehouse leaves out, the first by priority on a tie, though each line alone can', async () => {
      const { queries } = availability([
        {
          id: warehouseId,
          units: new Map([
            [shirt, 2],
            [cap, 1],
          ]),
        },
        { id: backup, units: new Map([[shirt, 5]]) },
      ]);
      const inventory = facade(new FakeReservations(), queries);

      // The first leaves out the shirts and the backup the cap: the first wins the tie.
      expect(
        await inventory.canFulfillTogether([
          { variantId: shirt, quantity: 3 },
          { variantId: cap, quantity: 1 },
        ]),
      ).toEqual(
        new Map([
          [shirt, false],
          [cap, true],
        ]),
      );
      // With a second cap, the first leaves out both lines and the backup only the caps: the backup is closer.
      expect(
        await inventory.canFulfillTogether([
          { variantId: shirt, quantity: 3 },
          { variantId: cap, quantity: 2 },
        ]),
      ).toEqual(
        new Map([
          [shirt, true],
          [cap, false],
        ]),
      );
      expect(
        await inventory.canFulfill([
          { variantId: shirt, quantity: 3 },
          { variantId: cap, quantity: 1 },
        ]),
      ).toEqual(
        new Map([
          [shirt, true],
          [cap, true],
        ]),
      );
    });

    it('answers no variant can without an active warehouse', async () => {
      expect(
        await facade(
          new FakeReservations(),
          availability([]).queries,
        ).canFulfillTogether([{ variantId: shirt, quantity: 1 }]),
      ).toEqual(new Map([[shirt, false]]));
    });
  });

  describe('reserve', () => {
    it('opens a reservation until the TTL passes and reserves every request, added up, in the first warehouse that holds them', async () => {
      const reservations = new FakeReservations();
      const { queries } = availability([
        { id: warehouseId, units: new Map([[shirt, 2]]) },
        { id: backup, units: new Map([[shirt, 3]]) },
      ]);

      const receipt = await facade(reservations, queries).reserve(orderId, [
        { variantId: shirt, quantity: 1 },
        { variantId: shirt, quantity: 2 },
      ]);

      expect(receipt).toMatchObject({
        orderId,
        expiresAt: new Date('2026-10-01T12:20:00.000Z'),
      });
      expect(reservations.reserved).toEqual([
        { warehouseId: backup, requests: [{ variantId: shirt, quantity: 3 }] },
      ]);
    });

    it('tries the next warehouse when the units it read went to another order, each try undoing itself', async () => {
      const reservations = new FakeReservations(
        null,
        new Map([[warehouseId, [cap]]]),
      );
      const { transactions, steps } = inlineTransactions();
      const lines = [
        { variantId: shirt, quantity: 1 },
        { variantId: cap, quantity: 1 },
      ];

      await facade(
        reservations,
        undefined,
        true,
        undefined,
        transactions,
      ).reserve(orderId, lines);

      expect(reservations.reserved).toEqual([
        { warehouseId, requests: lines },
        { warehouseId: backup, requests: lines },
      ]);
      // The reservation itself, and one step for each warehouse it tried.
      expect(steps.nested).toBe(3);
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

    it('rejects the reservation with what the closest warehouse leaves out when none holds the order (BR-INV-02)', async () => {
      const reservations = new FakeReservations();
      const { queries, asked } = availability([
        {
          id: warehouseId,
          units: new Map([
            [shirt, 1],
            [cap, 1],
          ]),
        },
        { id: backup, units: new Map([[shirt, 1]]) },
      ]);

      await expect(
        facade(reservations, queries).reserve(orderId, [
          { variantId: shirt, quantity: 1 },
          { variantId: cap, quantity: 2 },
          { variantId: unstocked, quantity: 1 },
        ]),
      ).rejects.toThrow(new InsufficientStockError([cap, unstocked]));
      expect(reservations.reserved).toEqual([]);
      expect(asked).toHaveLength(2);
    });

    it('rejects the reservation with what is short now when every warehouse it tried lost the units', async () => {
      const reservations = new FakeReservations(
        null,
        new Map([
          [warehouseId, [cap]],
          [backup, [shirt]],
        ]),
      );
      let reads = 0;
      const queries = {
        // Plenty of everything at first; after the tries, the first warehouse has no caps left.
        activeStock: (): Promise<WarehouseStock[]> => {
          reads += 1;
          return Promise.resolve([
            {
              warehouseId,
              available: new Map([
                [shirt, 5],
                [cap, reads === 1 ? 5 : 0],
              ]),
            },
            {
              warehouseId: backup,
              available: new Map([
                [shirt, reads === 1 ? 5 : 0],
                [cap, reads === 1 ? 5 : 0],
              ]),
            },
          ]);
        },
      } as unknown as InventoryQueries;

      await expect(
        facade(reservations, queries).reserve(orderId, [
          { variantId: shirt, quantity: 1 },
          { variantId: cap, quantity: 1 },
        ]),
      ).rejects.toThrow(new InsufficientStockError([cap]));
      expect(reservations.reserved.map(({ warehouseId: id }) => id)).toEqual([
        warehouseId,
        backup,
      ]);
    });

    it('rejects every line without an active warehouse', async () => {
      await expect(
        facade(new FakeReservations(), availability([]).queries).reserve(
          orderId,
          [{ variantId: shirt, quantity: 1 }],
        ),
      ).rejects.toThrow(new InsufficientStockError([shirt]));
    });

    it('rejects a reservation without requests', async () => {
      await expect(
        facade(new FakeReservations()).reserve(orderId, []),
      ).rejects.toThrow(InvalidValueError);
    });
  });

  it('answers the warehouses the confirmed stock of an order left from', async () => {
    const allocation: Allocation[] = [
      { warehouseId: backup, lines: [{ variantId: shirt, quantity: 2 }] },
    ];

    expect(
      await facade(
        new FakeReservations(null, new Map(), true, allocation),
      ).allocationOf(orderId),
    ).toBe(allocation);
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
          new FakeReservations(null, new Map(), committed),
          undefined,
          true,
          ledger,
        ),
      };
    };

    it('brings each line back to the first active warehouse with its reason, order, line, note and staff member', async () => {
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

    it('fails loudly without the warehouse the migration creates', async () => {
      const ledger = new FakeLedger();

      await expect(
        facade(
          new FakeReservations(null, new Map(), true),
          undefined,
          false,
          ledger,
        ).restock({
          orderId,
          reasonCode: 'ORDER_CANCELLED',
          note: null,
          actorId,
          lines: [
            { orderLineId: first, variantId: shirt, sold: 1, quantity: 1 },
          ],
        }),
      ).rejects.toThrow('There is no active warehouse');
      expect(ledger.written).toEqual([]);
    });
  });
});
