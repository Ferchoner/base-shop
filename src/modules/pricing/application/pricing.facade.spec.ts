import { Money, newId } from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import { PriceListRepository } from '../domain/price-list.repository.js';
import type { VariantId } from '../domain/variant-price.js';
import { PricingFacade } from './pricing.facade.js';
import {
  type PriceListView,
  type PricePeriodView,
  PricingQueries,
  type PriceQuote,
} from './pricing.queries.js';

const mxn = (amount: number) => Money.of(amount, 'MXN');

class FixedLists extends PriceListRepository {
  constructor(private readonly defaultList: PriceListId | null) {
    super();
  }

  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  findDefault(): Promise<PriceListId | null> {
    return Promise.resolve(this.defaultList);
  }
}

/** Answers a price for the variants it knows, and remembers what it was asked. */
class FixedPrices extends PricingQueries {
  readonly asked: { list: PriceListId; ids: VariantId[]; at: Date }[] = [];

  constructor(private readonly known: readonly PriceQuote[]) {
    super();
  }

  listPriceLists(): Promise<PriceListView[]> {
    return Promise.reject(new Error('not used'));
  }

  listPeriods(): Promise<PricePeriodView[]> {
    return Promise.reject(new Error('not used'));
  }

  currentPrices(
    list: PriceListId,
    ids: readonly VariantId[],
    at: Date,
  ): Promise<PriceQuote[]> {
    this.asked.push({ list, ids: [...ids], at });
    return Promise.resolve(
      this.known.filter(({ variantId }) => ids.includes(variantId)),
    );
  }
}

describe('PricingFacade (UC-PRC-06)', () => {
  const list = newId<'PriceList'>();
  const shirt = newId<'Variant'>();
  const cap = newId<'Variant'>();
  const unpriced = newId<'Variant'>();
  const at = new Date('2026-11-14T06:00:00.000Z');
  const quotes: PriceQuote[] = [
    { variantId: shirt, amount: mxn(59_900), compareAtAmount: mxn(79_900) },
    { variantId: cap, amount: mxn(19_900), compareAtAmount: null },
  ];

  it('quotes each variant once in the default list, at the instant asked, and leaves out those without a price', async () => {
    const prices = new FixedPrices(quotes);
    const facade = new PricingFacade(new FixedLists(list), prices);

    const quoted = await facade.quote([shirt, unpriced, shirt, cap], at);

    expect(prices.asked).toEqual([{ list, ids: [shirt, unpriced, cap], at }]);
    expect(quoted).toEqual(
      new Map([
        [shirt, quotes[0]],
        [cap, quotes[1]],
      ]),
    );
  });

  it('asks nothing for no variants', async () => {
    const prices = new FixedPrices(quotes);

    expect(
      await new PricingFacade(new FixedLists(null), prices).quote([], at),
    ).toEqual(new Map());
    expect(prices.asked).toEqual([]);
  });

  it('fails loudly without the default list the migration creates', async () => {
    const facade = new PricingFacade(
      new FixedLists(null),
      new FixedPrices(quotes),
    );

    await expect(facade.quote([shirt], at)).rejects.toThrow(
      'There is no default price list',
    );
  });
});
