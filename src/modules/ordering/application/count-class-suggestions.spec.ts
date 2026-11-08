import { toId } from '../../../shared-kernel/index.js';
import type { VariantId } from '../domain/order.js';
import {
  CountClassSuggester,
  type ProductOfVariant,
  SalesCatalog,
} from './count-class-suggestions.js';
import type { OrderingQueries } from './ordering.queries.js';

const variant = (n: number) =>
  toId<'Variant'>(`0199e0a1-0000-7000-8000-${String(n).padStart(12, '0')}`);

class FixedCatalog extends SalesCatalog {
  constructor(private readonly products: Map<VariantId, ProductOfVariant>) {
    super();
  }

  productsOf(ids: readonly VariantId[]) {
    return Promise.resolve(
      new Map(
        ids.flatMap((id) => {
          const product = this.products.get(id);
          return product === undefined ? [] : [[id, product] as const];
        }),
      ),
    );
  }
}

describe('CountClassSuggester (ADR-0173)', () => {
  const now = new Date('2026-11-08T18:00:00.000Z');

  it('adds up the variants of each product over the last 90 days, and suggests by the products', async () => {
    const asked: [Date, Date][] = [];
    const queries = {
      salesByVariant: (from: Date, to: Date) => {
        asked.push([from, to]);
        return Promise.resolve([
          { variantId: variant(1), amount: 40_000, units: 4 },
          { variantId: variant(2), amount: 50_000, units: 5 },
          { variantId: variant(3), amount: 8_000, units: 8 },
          { variantId: variant(4), amount: 2_000, units: 1 },
          // Not in Catalog: never happens, and is left out.
          { variantId: variant(9), amount: 1_000_000, units: 1 },
        ]);
      },
    } as unknown as OrderingQueries;
    const catalog = new FixedCatalog(
      new Map([
        [
          variant(1),
          { productId: 'zelda', productTitle: 'Zelda', countClass: null },
        ],
        [
          variant(2),
          { productId: 'zelda', productTitle: 'Zelda', countClass: null },
        ],
        [
          variant(3),
          { productId: 'cable', productTitle: 'Cable', countClass: 'A' },
        ],
        [
          variant(4),
          { productId: 'funda', productTitle: 'Funda', countClass: 'C' },
        ],
      ]),
    );

    const found = await new CountClassSuggester(queries, catalog, {
      now: () => now,
    }).suggest();

    expect(asked).toEqual([[new Date('2026-08-10T18:00:00.000Z'), now]]);
    expect(found).toEqual({
      from: new Date('2026-08-10T18:00:00.000Z'),
      to: now,
      total: 100_000,
      products: [
        {
          productId: 'zelda',
          productTitle: 'Zelda',
          countClass: null,
          amount: 90_000,
          units: 9,
          suggestedClass: 'A',
        },
        {
          productId: 'cable',
          productTitle: 'Cable',
          countClass: 'A',
          amount: 8_000,
          units: 8,
          suggestedClass: 'B',
        },
        {
          productId: 'funda',
          productTitle: 'Funda',
          countClass: 'C',
          amount: 2_000,
          units: 1,
          suggestedClass: 'C',
        },
      ],
    });
  });
});
