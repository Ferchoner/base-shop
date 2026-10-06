import { newId } from '../../../shared-kernel/index.js';
import { restockDestinations } from './restock-destinations.js';

const [main, north] = [newId<'Warehouse'>(), newId<'Warehouse'>()];
const [shirt, cap] = [newId<'Variant'>(), newId<'Variant'>()];
const [first, second] = [newId<'OrderLine'>(), newId<'OrderLine'>()];

describe('Where the units of a restock come back (ADR-0160)', () => {
  it('sends each line back to the warehouse its variant left', () => {
    expect(
      restockDestinations(
        [
          { orderLineId: first, variantId: shirt, quantity: 2 },
          { orderLineId: second, variantId: cap, quantity: 1 },
        ],
        [
          { warehouseId: north, variantId: cap, units: 1 },
          { warehouseId: main, variantId: shirt, units: 3 },
        ],
      ),
    ).toEqual([
      { orderLineId: first, variantId: shirt, warehouseId: main, quantity: 2 },
      { orderLineId: second, variantId: cap, warehouseId: north, quantity: 1 },
    ]);
  });

  it('spreads a line over the warehouses it left, in their order, each up to what can still come back there', () => {
    expect(
      restockDestinations(
        [{ orderLineId: first, variantId: shirt, quantity: 4 }],
        [
          { warehouseId: main, variantId: shirt, units: 0 },
          { warehouseId: north, variantId: shirt, units: 3 },
          { warehouseId: main, variantId: shirt, units: 5 },
        ],
      ),
    ).toEqual([
      { orderLineId: first, variantId: shirt, warehouseId: north, quantity: 3 },
      { orderLineId: first, variantId: shirt, warehouseId: main, quantity: 1 },
    ]);
  });

  it('counts what one line takes before the next one of the same variant', () => {
    expect(
      restockDestinations(
        [
          { orderLineId: first, variantId: shirt, quantity: 2 },
          { orderLineId: second, variantId: shirt, quantity: 1 },
        ],
        [
          { warehouseId: main, variantId: shirt, units: 2 },
          { warehouseId: north, variantId: shirt, units: 1 },
        ],
      ),
    ).toEqual([
      { orderLineId: first, variantId: shirt, warehouseId: main, quantity: 2 },
      {
        orderLineId: second,
        variantId: shirt,
        warehouseId: north,
        quantity: 1,
      },
    ]);
  });

  it('fails loudly for units that left no warehouse', () => {
    expect(() =>
      restockDestinations(
        [{ orderLineId: first, variantId: shirt, quantity: 2 }],
        [
          { warehouseId: main, variantId: shirt, units: 1 },
          { warehouseId: main, variantId: cap, units: 5 },
        ],
      ),
    ).toThrow(`Line ${first} has no warehouse to come back to`);
  });
});
