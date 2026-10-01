import {
  type Id,
  newId,
  NotFoundError,
  type PageRequest,
} from '../../../shared-kernel/index.js';
import {
  UnknownBrandsFilterError,
  UnknownCategoryFilterError,
} from '../domain/product-errors.js';
import { searchWords, Storefront } from './storefront.js';
import type {
  ProductDetailView,
  StorefrontCriteria,
  StorefrontQueries,
} from './storefront.queries.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const PAGE: PageRequest = { page: 2, pageSize: 10 };
const clothes = newId<'Category'>();
const shirts = newId<'Category'>();
const brandOne = newId<'Brand'>();
const brandTwo = newId<'Brand'>();

/** Queries in memory: they remember what the store asked for. */
function fakeQueries(found: { product?: ProductDetailView } = {}) {
  const asked: { method: string; args: unknown[] }[] = [];
  const remember =
    <T>(method: string, answer: T) =>
    (...args: unknown[]) => {
      asked.push({ method, args });
      return Promise.resolve(answer);
    };
  const queries = {
    visibleCategoryTree: (slug: string) => {
      asked.push({ method: 'visibleCategoryTree', args: [slug] });
      return Promise.resolve(slug === 'ropa' ? [clothes, shirts] : []);
    },
    activeBrandIds: (slugs: readonly string[]) => {
      asked.push({ method: 'activeBrandIds', args: [slugs] });
      const known = new Map<string, Id<'Brand'>>([
        ['uno', brandOne],
        ['dos', brandTwo],
      ]);
      return Promise.resolve(slugs.flatMap((slug) => known.get(slug) ?? []));
    },
    listProducts: remember('listProducts', { items: [], totalItems: 7 }),
    findProduct: remember('findProduct', found.product ?? null),
    listBrands: remember('listBrands', []),
    visibilities: remember('visibilities', ['VISIBLE']),
  } as unknown as StorefrontQueries;
  return { queries, asked };
}

const storefrontWith = (queries: StorefrontQueries) =>
  new Storefront(queries, { now: () => NOW });

const criteriaOf = (asked: { method: string; args: unknown[] }[]) =>
  asked.find(({ method }) => method === 'listProducts')?.args;

describe('Storefront (UC-CAT-01 and 02, ADR-0060)', () => {
  describe('searchWords', () => {
    it('keeps runs of letters and digits, in any alphabet, and drops everything else', () => {
      expect(searchWords('¡Camisa  de-lino, talla 2XL!')).toEqual([
        'Camisa',
        'de',
        'lino',
        'talla',
        '2XL',
      ]);
      expect(searchWords('piñata ÜBER café')).toEqual([
        'piñata',
        'ÜBER',
        'café',
      ]);
      expect(searchWords("'& | ! :*")).toEqual([]);
    });
  });

  describe('products', () => {
    it('lists newest first without search text, at the current time', async () => {
      const { queries, asked } = fakeQueries();

      const page = await storefrontWith(queries).products(
        { availableOnly: false },
        PAGE,
      );

      expect(page).toEqual({ items: [], totalItems: 7 });
      expect(criteriaOf(asked)).toEqual([
        {
          words: undefined,
          categoryIds: undefined,
          brandIds: undefined,
          minPrice: undefined,
          maxPrice: undefined,
          availableOnly: false,
          sort: '-publishedAt',
        } satisfies StorefrontCriteria,
        PAGE,
        NOW,
      ]);
    });

    it('turns the search into words, orders by relevance by default, and turns slugs into IDs', async () => {
      const { queries, asked } = fakeQueries();

      await storefrontWith(queries).products(
        {
          q: 'camisa lino',
          category: 'ropa',
          brands: ['uno', 'dos', 'uno'],
          minPrice: 100,
          maxPrice: 900,
          availableOnly: true,
        },
        PAGE,
      );

      expect(asked.find(({ method }) => method === 'activeBrandIds')).toEqual({
        method: 'activeBrandIds',
        args: [['uno', 'dos']],
      });
      expect(criteriaOf(asked)?.[0]).toEqual({
        words: ['camisa', 'lino'],
        categoryIds: [clothes, shirts],
        brandIds: [brandOne, brandTwo],
        minPrice: 100,
        maxPrice: 900,
        availableOnly: true,
        sort: 'relevance',
      });
    });

    it('keeps the order asked for, with or without search text', async () => {
      const { queries, asked } = fakeQueries();

      await storefrontWith(queries).products(
        { q: 'camisa', availableOnly: false, sort: 'price' },
        PAGE,
      );

      expect(criteriaOf(asked)?.[0]).toMatchObject({ sort: 'price' });
    });

    it('finds nothing for a text without letters or digits, without asking the database', async () => {
      const { queries, asked } = fakeQueries();

      expect(
        await storefrontWith(queries).products(
          { q: '¡!', availableOnly: false },
          PAGE,
        ),
      ).toEqual({ items: [], totalItems: 0 });
      expect(asked).toEqual([]);
    });

    it('rejects a category it cannot show, even with a text that finds nothing (ADR-0080)', async () => {
      const { queries, asked } = fakeQueries();

      await expect(
        storefrontWith(queries).products(
          { q: '¡!', category: 'oculta', availableOnly: false },
          PAGE,
        ),
      ).rejects.toThrow(UnknownCategoryFilterError);
      expect(criteriaOf(asked)).toBeUndefined();
    });

    it('rejects the listing when a brand is unknown or inactive', async () => {
      const { queries, asked } = fakeQueries();

      await expect(
        storefrontWith(queries).products(
          { q: '¡!', brands: ['uno', 'tres'], availableOnly: false },
          PAGE,
        ),
      ).rejects.toThrow(UnknownBrandsFilterError);
      expect(criteriaOf(asked)).toBeUndefined();
    });
  });

  describe('product', () => {
    it('answers the product the store shows, read at the current time', async () => {
      const product = { slug: 'camisa-lino' } as ProductDetailView;
      const { queries, asked } = fakeQueries({ product });

      expect(await storefrontWith(queries).product('camisa-lino')).toBe(
        product,
      );
      expect(asked).toEqual([
        { method: 'findProduct', args: ['camisa-lino', NOW] },
      ]);
    });

    it('answers 404 without looking up a slug that no product could have', async () => {
      const { queries, asked } = fakeQueries();
      const storefront = storefrontWith(queries);

      for (const slug of ['Camisa', 'camisa--lino', 'a'.repeat(201)]) {
        await expect(storefront.product(slug)).rejects.toThrow(NotFoundError);
      }
      await expect(storefront.product('a'.repeat(200))).rejects.toThrow(
        NotFoundError,
      );
      expect(asked).toEqual([
        { method: 'findProduct', args: ['a'.repeat(200), NOW] },
      ]);
    });
  });

  describe('brands and visibility', () => {
    it('reads the brands and the visibility at the current time', async () => {
      const { queries, asked } = fakeQueries();
      const storefront = storefrontWith(queries);
      const product = newId<'Product'>();

      await storefront.brands();
      expect(await storefront.visibilities([product])).toEqual(['VISIBLE']);

      expect(asked).toEqual([
        { method: 'listBrands', args: [NOW] },
        { method: 'visibilities', args: [[product], NOW] },
      ]);
    });

    it('asks nothing for no products', async () => {
      const { queries, asked } = fakeQueries();

      expect(await storefrontWith(queries).visibilities([])).toEqual([]);
      expect(asked).toEqual([]);
    });
  });
});
