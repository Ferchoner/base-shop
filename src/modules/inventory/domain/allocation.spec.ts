import { newId } from '../../../shared-kernel/index.js';
import {
  fulfillableAlone,
  ONE_WAREHOUSE_PER_ORDER,
  shortIn,
  shortInClosest,
  type WarehouseStock,
} from './allocation.js';
import type { VariantId } from './stock.js';

const [north, south] = [newId<'Warehouse'>(), newId<'Warehouse'>()];
const [shirt, cap, mug] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];

/** A warehouse with the available units of each variant it has a stock item of. */
const stock = (
  warehouseId: WarehouseStock['warehouseId'],
  units: [VariantId, number][],
): WarehouseStock => ({ warehouseId, available: new Map(units) });

describe('Allocation of an order to the warehouses (ADR-0160)', () => {
  it('finds short the requests a warehouse has fewer units of, or none', () => {
    const warehouse = stock(north, [
      [shirt, 2],
      [cap, 0],
    ]);

    expect(
      shortIn(warehouse, [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
        { variantId: mug, quantity: 1 },
      ]),
    ).toEqual([cap, mug]);
    expect(shortIn(warehouse, [{ variantId: shirt, quantity: 3 }])).toEqual([
      shirt,
    ]);
  });

  it('plans every unit of the order in one warehouse, each that holds all of it, in their order', () => {
    const requests = [
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ];
    const warehouses = [
      stock(north, [[shirt, 5]]),
      stock(south, [
        [shirt, 2],
        [cap, 1],
      ]),
      stock(north, [
        [shirt, 9],
        [cap, 9],
      ]),
    ];

    expect(ONE_WAREHOUSE_PER_ORDER.plans(warehouses, requests)).toEqual([
      [{ warehouseId: south, lines: requests }],
      [{ warehouseId: north, lines: requests }],
    ]);
    expect(ONE_WAREHOUSE_PER_ORDER.plans([], requests)).toEqual([]);
  });

  it('tells per request whether some warehouse alone has its units', () => {
    expect(
      fulfillableAlone(
        [stock(north, [[shirt, 2]]), stock(south, [[cap, 3]])],
        [
          { variantId: shirt, quantity: 2 },
          { variantId: cap, quantity: 4 },
          { variantId: mug, quantity: 1 },
        ],
      ),
    ).toEqual(
      new Map([
        [shirt, true],
        [cap, false],
        [mug, false],
      ]),
    );
  });

  it('leaves out what the closest warehouse lacks, the first one on a tie, and everything without warehouses', () => {
    const requests = [
      { variantId: shirt, quantity: 1 },
      { variantId: cap, quantity: 1 },
      { variantId: mug, quantity: 1 },
    ];

    expect(
      shortInClosest(
        [
          stock(north, [[shirt, 1]]),
          stock(south, [
            [cap, 1],
            [mug, 1],
          ]),
        ],
        requests,
      ),
    ).toEqual([shirt]);
    expect(
      shortInClosest(
        [stock(north, [[shirt, 1]]), stock(south, [[cap, 1]])],
        requests,
      ),
    ).toEqual([cap, mug]);
    expect(shortInClosest([stock(north, [])], requests)).toEqual([
      shirt,
      cap,
      mug,
    ]);
    expect(shortInClosest([], requests)).toEqual([shirt, cap, mug]);
  });
});
