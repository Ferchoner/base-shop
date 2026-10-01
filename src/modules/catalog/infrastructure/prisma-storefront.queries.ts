import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Currency,
  Money,
  type Page,
  pageOffset,
  type PageRequest,
  toId,
} from '../../../shared-kernel/index.js';
import type { ProductImageView } from '../application/catalog.queries.js';
import {
  type ProductDetailView,
  type ProductSummaryView,
  type StoreBrandView,
  type StorefrontCriteria,
  StorefrontQueries,
  type StorefrontSort,
  type StoreVisibility,
  type StoreVariantView,
} from '../application/storefront.queries.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductId } from '../domain/product-id.js';
import { optionNamesOf, type VariantOptions } from '../domain/variant.js';

/** Spanish order for names and titles: ñ after n, without telling accents or case apart first. */
const SPANISH = Prisma.raw('COLLATE "es-x-icu"');

/** The brand of product `p` as JSON, or `NULL` without one. */
const BRAND = Prisma.sql`(
  SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug) FROM brands b WHERE b.id = p.brand_id
)`;

/** Visible categories (BR-PRD-17): active, with every ancestor active. UNION stops even on a cycle. */
const VISIBLE_CATEGORIES = Prisma.sql`visible (id) AS (
  SELECT id FROM categories WHERE parent_id IS NULL AND status = 'ACTIVE'
  UNION
  SELECT c.id FROM categories c JOIN visible v ON c.parent_id = v.id WHERE c.status = 'ACTIVE'
)`;

/**
 * Sellable variants (BR-PRD-11), with the price current at `at` in the default list and whether they are
 * available: units not reserved in the active warehouse (ADR-0061, ADR-0081). `where` narrows the variants
 * (`v`) or their products (`p`) before anything else is read.
 */
function sellable(at: Date, where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT v.id AS variant_id, v.product_id, v.sku, v.options, v.created_at, p.brand_id,
           pp.amount, pp.compare_at_amount, pl.currency,
           coalesce(si.on_hand - si.reserved, 0) > 0 AS available
      FROM product_variants v
      JOIN products p ON p.id = v.product_id AND p.status = 'PUBLISHED'
      JOIN variant_prices vp ON vp.variant_id = v.id
      JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default
      JOIN price_periods pp ON pp.variant_price_id = vp.id
                           AND pp.effective_from <= ${at}::timestamptz
                           AND (pp.effective_to IS NULL OR pp.effective_to > ${at}::timestamptz)
      LEFT JOIN warehouses w ON w.status = 'ACTIVE'
      LEFT JOIN stock_items si ON si.variant_id = v.id AND si.warehouse_id = w.id
     WHERE v.status = 'ACTIVE' AND ${where}`;
}

/**
 * The search text as a query of PostgreSQL (ADR-0060, ADR-0123): each word without accents, in the Spanish
 * configuration that built `search_vector`, as the start of a word, and all of them required. Quoting each
 * word keeps its characters out of the query syntax; a stop word ("de") drops out on its own.
 */
function searchQuery(words: readonly string[]): Prisma.Sql {
  const terms = words.map(
    (word) =>
      Prisma.sql`to_tsquery('spanish', quote_literal(unaccent(${word})) || ':*')`,
  );
  return Prisma.sql`(${Prisma.join(terms, ' && ')})`;
}

/** Each order of the listing (API_SPEC.md §11.2); the ID breaks ties, so pages are stable (ADR-0036). */
function orderBy(sort: StorefrontSort, query: Prisma.Sql | null): Prisma.Sql {
  switch (sort) {
    case 'relevance':
      if (query !== null) {
        return Prisma.sql`ts_rank(p.search_vector, ${query}) DESC, p.published_at DESC, p.id`;
      }
      // Without words, every product matches as much: newest first, as without a search.
      return orderBy('-publishedAt', null);
    case '-publishedAt':
      return Prisma.sql`p.published_at DESC, p.id`;
    case 'price':
      return Prisma.sql`o.amount, p.id`;
    case '-price':
      return Prisma.sql`o.amount DESC, p.id`;
    case 'title':
      return Prisma.sql`p.title ${SPANISH}, p.id`;
    case '-title':
      return Prisma.sql`p.title ${SPANISH} DESC, p.id`;
  }
}

interface BrandJson {
  id: string;
  name: string;
  slug: string;
}

interface ImageJson {
  id: string;
  storageKey: string;
  altText: string | null;
  position: number;
  variantId: string | null;
}

interface SummaryRow {
  id: string;
  slug: string;
  title: string;
  published_at: Date;
  brand: BrandJson | null;
  amount: number;
  compare_at_amount: number | null;
  currency: string;
  available: boolean;
  image: ImageJson | null;
}

interface ProductRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  published_at: Date;
  brand: BrandJson | null;
}

interface VariantRow {
  variant_id: string;
  sku: string;
  options: VariantOptions;
  amount: number;
  compare_at_amount: number | null;
  currency: string;
  available: boolean;
}

/**
 * The reads of the public store (ADR-0060, ADR-0129). The only code allowed to read tables of Pricing
 * (`price_lists`, `variant_prices`, `price_periods`) and Inventory (`warehouses`, `stock_items`), always in the
 * same statement as the Catalog tables, so filters, orders and totals by price and availability are exact.
 * `test/boundaries/table-ownership.spec.ts` keeps every other file to the tables of its own context.
 */
@Injectable()
export class PrismaStorefrontQueries extends StorefrontQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async visibleCategoryTree(slug: string): Promise<CategoryId[]> {
    // Under a visible category, an active subcategory is visible too.
    const rows = await this.txHost.tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE ${VISIBLE_CATEGORIES},
      tree (id) AS (
        SELECT id FROM categories WHERE slug = ${slug} AND id IN (SELECT id FROM visible)
        UNION
        SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id WHERE c.status = 'ACTIVE'
      )
      SELECT id FROM tree`;
    return rows.map(({ id }) => toId<'Category'>(id));
  }

  async activeBrandIds(slugs: readonly string[]): Promise<BrandId[]> {
    const rows = await this.txHost.tx.brand.findMany({
      where: { slug: { in: [...slugs] }, status: 'ACTIVE' },
      select: { id: true },
    });
    return rows.map(({ id }) => toId<'Brand'>(id));
  }

  async listProducts(
    criteria: StorefrontCriteria,
    page: PageRequest,
    at: Date,
  ): Promise<Page<ProductSummaryView>> {
    const query =
      criteria.words === undefined ? null : searchQuery(criteria.words);
    // `offers` holds only published products with a sellable variant.
    const conditions = [Prisma.sql`TRUE`];
    if (query !== null) {
      conditions.push(Prisma.sql`p.search_vector @@ ${query}`);
    }
    if (criteria.categoryIds !== undefined) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_categories pc
         WHERE pc.product_id = p.id AND pc.category_id = ANY(${[...criteria.categoryIds]}::uuid[]))`);
    }
    if (criteria.brandIds !== undefined) {
      conditions.push(
        Prisma.sql`p.brand_id = ANY(${[...criteria.brandIds]}::uuid[])`,
      );
    }
    if (criteria.minPrice !== undefined) {
      conditions.push(Prisma.sql`o.amount >= ${criteria.minPrice}::int`);
    }
    if (criteria.maxPrice !== undefined) {
      conditions.push(Prisma.sql`o.amount <= ${criteria.maxPrice}::int`);
    }
    if (criteria.availableOnly) conditions.push(Prisma.sql`o.available`);
    const where = Prisma.join(conditions, ' AND ');
    // One offer per product: its lowest price, the oldest variant on a tie (BR-PRD-15), and whether any
    // sellable variant is available.
    const offers = Prisma.sql`
      WITH sellable AS (${sellable(at, Prisma.sql`TRUE`)}),
      offers AS (
        SELECT DISTINCT ON (product_id) product_id, amount, compare_at_amount, currency,
               bool_or(available) OVER (PARTITION BY product_id) AS available
          FROM sellable
         ORDER BY product_id, amount, created_at, variant_id
      )`;
    const [rows, [{ count }]] = await Promise.all([
      // The page is chosen first, so the brand and the image are read only for its products.
      this.txHost.tx.$queryRaw<SummaryRow[]>`
        ${offers},
        page AS (
          SELECT p.id, p.slug, p.title, p.published_at, p.brand_id,
                 o.amount, o.compare_at_amount, o.currency, o.available,
                 row_number() OVER (ORDER BY ${orderBy(criteria.sort, query)}) AS n
            FROM products p
            JOIN offers o ON o.product_id = p.id
           WHERE ${where}
           ORDER BY n
           LIMIT ${page.pageSize} OFFSET ${pageOffset(page)}
        )
        SELECT p.id, p.slug, p.title, p.published_at, ${BRAND} AS brand,
               p.amount, p.compare_at_amount, p.currency, p.available, i.image
          FROM page p
          LEFT JOIN LATERAL (
            SELECT jsonb_build_object('id', id, 'storageKey', storage_key, 'altText', alt_text,
                                      'position', position, 'variantId', variant_id) AS image
              FROM product_images
             WHERE product_id = p.id
               AND (variant_id IS NULL OR variant_id IN (SELECT variant_id FROM sellable))
             ORDER BY position, id
             LIMIT 1
          ) i ON TRUE
         ORDER BY p.n`,
      this.txHost.tx.$queryRaw<{ count: number }[]>`
        ${offers}
        SELECT count(*)::int AS count
          FROM products p
          JOIN offers o ON o.product_id = p.id
         WHERE ${where}`,
    ]);
    return { items: rows.map(toSummary), totalItems: count };
  }

  async findProduct(slug: string, at: Date): Promise<ProductDetailView | null> {
    const [product] = await this.txHost.tx.$queryRaw<ProductRow[]>`
      SELECT p.id, p.slug, p.title, p.description, p.published_at, ${BRAND} AS brand
        FROM products p
       WHERE p.slug = ${slug}`;
    if (product === undefined) return null;
    // Only a published product has sellable variants.
    const rows = await this.txHost.tx.$queryRaw<VariantRow[]>`
      SELECT variant_id, sku, options, amount, compare_at_amount, currency, available
        FROM (${sellable(at, Prisma.sql`v.product_id = ${product.id}::uuid`)}) s
       ORDER BY created_at, variant_id`;
    if (rows.length === 0) return null;
    const variants = rows.map(toVariant);
    const [categories, images] = await Promise.all([
      this.txHost.tx.$queryRaw<{ id: string; name: string; slug: string }[]>`
        WITH RECURSIVE ${VISIBLE_CATEGORIES}
        SELECT c.id, c.name, c.slug
          FROM product_categories pc
          JOIN categories c ON c.id = pc.category_id
         WHERE pc.product_id = ${product.id}::uuid AND c.id IN (SELECT id FROM visible)
         ORDER BY c.name ${SPANISH}, c.id`,
      this.txHost.tx.productImage.findMany({
        where: {
          productId: product.id,
          OR: [
            { variantId: null },
            { variantId: { in: variants.map(({ id }) => id) } },
          ],
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    ]);
    // Variants come oldest first, so on a tie the oldest one keeps the offer (BR-PRD-15).
    const offer = variants.reduce((lowest, variant) =>
      variant.price.amount < lowest.price.amount ? variant : lowest,
    );
    const imageViews = images.map(toImage);
    return {
      id: toId<'Product'>(product.id),
      slug: product.slug,
      title: product.title,
      brand: toBrand(product.brand),
      fromPrice: offer.price,
      compareAtPrice: offer.compareAtPrice,
      available: variants.some(({ available }) => available),
      image: imageViews[0] ?? null,
      publishedAt: product.published_at,
      description: product.description,
      categories: categories.map((category) => ({
        ...category,
        id: toId<'Category'>(category.id),
      })),
      images: imageViews,
      optionNames: optionNamesOf(variants[0].options),
      variants,
    };
  }

  async listBrands(at: Date): Promise<StoreBrandView[]> {
    const rows = await this.txHost.tx.$queryRaw<
      { id: string; name: string; slug: string }[]
    >`
      WITH sellable AS (${sellable(at, Prisma.sql`TRUE`)})
      SELECT b.id, b.name, b.slug
        FROM brands b
       WHERE b.status = 'ACTIVE' AND b.id IN (SELECT brand_id FROM sellable)
       ORDER BY b.name ${SPANISH}, b.id`;
    return rows.map((row) => ({ ...row, id: toId<'Brand'>(row.id) }));
  }

  async visibilities(
    ids: readonly ProductId[],
    at: Date,
  ): Promise<StoreVisibility[]> {
    const rows = await this.txHost.tx.$queryRaw<
      { published: boolean; sellable: boolean }[]
    >`
      WITH sellable AS (${sellable(at, Prisma.sql`v.product_id = ANY(${[...ids]}::uuid[])`)})
      SELECT coalesce(p.status = 'PUBLISHED', FALSE) AS published,
             EXISTS (SELECT 1 FROM sellable s WHERE s.product_id = asked.id) AS sellable
        FROM unnest(${[...ids]}::uuid[]) WITH ORDINALITY AS asked (id, n)
        LEFT JOIN products p ON p.id = asked.id
       ORDER BY asked.n`;
    return rows.map(({ published, sellable }) =>
      !published ? 'NOT_PUBLISHED' : sellable ? 'VISIBLE' : 'HIDDEN_NO_PRICE',
    );
  }
}

function money(amount: number, currency: string): Money {
  return Money.of(amount, currency as Currency);
}

function toBrand(brand: BrandJson | null): StoreBrandView | null {
  return brand === null ? null : { ...brand, id: toId<'Brand'>(brand.id) };
}

function toImage(image: ImageJson): ProductImageView {
  return {
    id: image.id,
    storageKey: image.storageKey,
    altText: image.altText,
    position: image.position,
    variantId:
      image.variantId === null ? null : toId<'Variant'>(image.variantId),
  };
}

function toVariant(row: VariantRow): StoreVariantView {
  return {
    id: toId<'Variant'>(row.variant_id),
    sku: row.sku,
    options: row.options,
    price: money(row.amount, row.currency),
    compareAtPrice:
      row.compare_at_amount === null
        ? null
        : money(row.compare_at_amount, row.currency),
    available: row.available,
  };
}

function toSummary(row: SummaryRow): ProductSummaryView {
  return {
    id: toId<'Product'>(row.id),
    slug: row.slug,
    title: row.title,
    brand: toBrand(row.brand),
    fromPrice: money(row.amount, row.currency),
    compareAtPrice:
      row.compare_at_amount === null
        ? null
        : money(row.compare_at_amount, row.currency),
    available: row.available,
    image: row.image === null ? null : toImage(row.image),
    publishedAt: row.published_at,
  };
}
