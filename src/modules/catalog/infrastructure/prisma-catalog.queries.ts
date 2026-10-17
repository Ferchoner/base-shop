import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
  toId,
} from '../../../shared-kernel/index.js';
import {
  type AdminProductView,
  type BrandFilter,
  type BrandSortField,
  type BrandView,
  type CatalogEntriesView,
  CatalogQueries,
  type CategoryView,
  type ProductFilter,
  type ProductImageView,
  type ProductSortField,
  type VariantClassificationView,
  type VariantLookupView,
  type VariantSnapshot,
} from '../application/catalog.queries.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import type { ProductId } from '../domain/product-id.js';
import {
  gtinKeyOf,
  type VariantId,
  type VariantOptions,
} from '../domain/variant.js';

const CATEGORY_FIELDS = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  status: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true, children: true } },
} as const;

const BRAND_FIELDS = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} as const;

const PRODUCT_FIELDS = {
  id: true,
  title: true,
  slug: true,
  brand: { select: { id: true, name: true } },
  categories: {
    select: { category: { select: { id: true, name: true } } },
    orderBy: { category: { name: 'asc' } },
  },
  status: true,
  storeOnly: true,
  variants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  images: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  publishedAt: true,
  firstPublishedAt: true,
  archivedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_FIELDS & { description: true };
}>;

type CategoryRow = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_FIELDS;
}>;
type BrandRow = Prisma.BrandGetPayload<{ select: typeof BRAND_FIELDS }>;

/** Read models of the administration (ADR-0120, ADR-0123), straight from the Catalog tables. */
@Injectable()
export class PrismaCatalogQueries extends CatalogQueries {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async listCategories(): Promise<CategoryView[]> {
    const rows = await this.txHost.tx.category.findMany({
      select: CATEGORY_FIELDS,
    });
    return rows.map(toCategoryView);
  }

  async findCategory(id: CategoryId): Promise<CategoryView | null> {
    const row = await this.txHost.tx.category.findUnique({
      select: CATEGORY_FIELDS,
      where: { id },
    });
    return row === null ? null : toCategoryView(row);
  }

  async listBrands(
    filter: BrandFilter,
    sort: readonly SortOrder<BrandSortField>[],
    page: PageRequest,
  ): Promise<Page<BrandView>> {
    const where: Prisma.BrandWhereInput = {
      ...(filter.q === undefined
        ? {}
        : { name: { contains: filter.q, mode: 'insensitive' } }),
      ...(filter.statuses === undefined
        ? {}
        : { status: { in: [...filter.statuses] } }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.brand.findMany({
        select: BRAND_FIELDS,
        where,
        // Then the ID, so pages are stable (ADR-0036).
        orderBy: [
          ...sort.map(({ field, direction }) => ({ [field]: direction })),
          { id: 'asc' },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.brand.count({ where }),
    ]);
    return { items: rows.map(toBrandView), totalItems };
  }

  async findBrand(id: BrandId): Promise<BrandView | null> {
    const row = await this.txHost.tx.brand.findUnique({
      select: BRAND_FIELDS,
      where: { id },
    });
    return row === null ? null : toBrandView(row);
  }

  async listProducts(
    filter: ProductFilter,
    sort: readonly SortOrder<ProductSortField>[],
    page: PageRequest,
  ): Promise<Page<AdminProductView>> {
    const where: Prisma.ProductWhereInput = {
      ...(filter.q === undefined
        ? {}
        : {
            OR: [
              { title: { contains: filter.q, mode: 'insensitive' } },
              {
                variants: {
                  some: { sku: { contains: filter.q.toUpperCase() } },
                },
              },
              { variants: { some: { gtin: { contains: filter.q } } } },
            ],
          }),
      ...(filter.statuses === undefined
        ? {}
        : { status: { in: [...filter.statuses] } }),
      ...(filter.brandId === undefined ? {} : { brandId: filter.brandId }),
      ...(filter.categoryId === undefined
        ? {}
        : { categories: { some: { categoryId: filter.categoryId } } }),
      ...(filter.storeOnly === undefined
        ? {}
        : { storeOnly: filter.storeOnly }),
    };
    const [rows, totalItems] = await Promise.all([
      this.txHost.tx.product.findMany({
        select: PRODUCT_FIELDS,
        where,
        // Products never published go last by publication date; then the ID, so pages are stable (ADR-0036).
        orderBy: [
          ...sort.map(({ field, direction }) =>
            field === 'publishedAt'
              ? { publishedAt: { sort: direction, nulls: 'last' as const } }
              : { [field]: direction },
          ),
          { id: 'asc' as const },
        ],
        skip: pageOffset(page),
        take: page.pageSize,
      }),
      this.txHost.tx.product.count({ where }),
    ]);
    return { items: rows.map((row) => toProductView(row)), totalItems };
  }

  async findProduct(id: ProductId): Promise<AdminProductView | null> {
    const row = await this.txHost.tx.product.findUnique({
      select: { ...PRODUCT_FIELDS, description: true },
      where: { id },
    });
    return row === null ? null : toProductView(row);
  }

  findVariants(ids: readonly VariantId[]): Promise<VariantSnapshot[]> {
    return this.variantsWhere({ id: { in: [...ids] } });
  }

  findVariantsBySku(skus: readonly string[]): Promise<VariantSnapshot[]> {
    return this.variantsWhere({ sku: { in: [...skus] } });
  }

  searchVariants(text: string): Promise<VariantSnapshot[]> {
    return this.variantsWhere({
      OR: [
        { sku: { contains: text.toUpperCase() } },
        { product: { title: { contains: text, mode: 'insensitive' } } },
      ],
    });
  }

  async lookUpVariants(code: string): Promise<VariantLookupView[]> {
    const sku = code.toUpperCase();
    const key = gtinKeyOf(code);
    const rows = await this.txHost.tx.productVariant.findMany({
      where: { OR: [{ sku }, ...(key === null ? [] : [{ gtinKey: key }])] },
      include: {
        product: {
          select: { id: true, title: true, slug: true, status: true },
        },
      },
      orderBy: { sku: 'asc' },
    });
    return rows
      .map((row) => ({
        id: toId<'Variant'>(row.id),
        sku: row.sku,
        gtin: row.gtin,
        options: row.options as VariantOptions,
        status: row.status,
        matchedBy: row.sku === sku ? ('SKU' as const) : ('GTIN' as const),
        product: {
          id: toId<'Product'>(row.product.id),
          title: row.product.title,
          slug: row.product.slug,
          status: row.product.status,
        },
      }))
      .sort(
        (a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'),
      );
  }

  async findEntries(ids: {
    readonly productIds: readonly ProductId[];
    readonly categoryIds: readonly CategoryId[];
    readonly brandIds: readonly BrandId[];
  }): Promise<CatalogEntriesView> {
    const tx = this.txHost.tx;
    const [products, categories, brands] = await Promise.all([
      ids.productIds.length === 0
        ? []
        : tx.product.findMany({
            select: { id: true, title: true, status: true },
            where: { id: { in: [...ids.productIds] } },
            orderBy: { id: 'asc' },
          }),
      ids.categoryIds.length === 0
        ? []
        : tx.category.findMany({
            select: { id: true, name: true, status: true },
            where: { id: { in: [...ids.categoryIds] } },
            orderBy: { id: 'asc' },
          }),
      ids.brandIds.length === 0
        ? []
        : tx.brand.findMany({
            select: { id: true, name: true, status: true },
            where: { id: { in: [...ids.brandIds] } },
            orderBy: { id: 'asc' },
          }),
    ]);
    return {
      products: products.map(({ id, title, status }) => ({
        id,
        name: title,
        status,
      })),
      categories,
      brands,
    };
  }

  async classifyVariants(
    ids: readonly VariantId[],
  ): Promise<VariantClassificationView[]> {
    const tx = this.txHost.tx;
    const [variants, lineage] = await Promise.all([
      tx.productVariant.findMany({
        select: {
          id: true,
          productId: true,
          product: { select: { brandId: true } },
        },
        where: { id: { in: [...ids] } },
        orderBy: { id: 'asc' },
      }),
      // The categories of each product and, walking up the tree, every one above them (ADR-0168).
      tx.$queryRaw<{ variant_id: string; category_id: string }[]>`
        WITH RECURSIVE lineage (variant_id, category_id) AS (
          SELECT v.id, pc.category_id
            FROM product_variants v
            JOIN product_categories pc ON pc.product_id = v.product_id
           WHERE v.id = ANY(${[...ids]}::uuid[])
          UNION
          SELECT l.variant_id, c.parent_id
            FROM lineage l
            JOIN categories c ON c.id = l.category_id
           WHERE c.parent_id IS NOT NULL
        )
        SELECT variant_id::text, category_id::text
          FROM lineage
         ORDER BY variant_id, category_id`,
    ]);
    return variants.map((row) => ({
      variantId: toId<'Variant'>(row.id),
      productId: toId<'Product'>(row.productId),
      brandId:
        row.product.brandId === null
          ? null
          : toId<'Brand'>(row.product.brandId),
      categoryIds: lineage
        .filter(({ variant_id }) => variant_id === row.id)
        .map(({ category_id }) => toId<'Category'>(category_id)),
    }));
  }

  async findImagesOfProducts(
    ids: readonly ProductId[],
  ): Promise<(ProductImageView & { productId: ProductId })[]> {
    const rows = await this.txHost.tx.productImage.findMany({
      where: { productId: { in: [...ids] } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      productId: toId<'Product'>(row.productId),
      storageKey: row.storageKey,
      altText: row.altText,
      position: row.position,
      variantId: row.variantId === null ? null : toId<'Variant'>(row.variantId),
    }));
  }

  private async variantsWhere(
    where: Prisma.ProductVariantWhereInput,
  ): Promise<VariantSnapshot[]> {
    const rows = await this.txHost.tx.productVariant.findMany({
      where,
      include: {
        product: {
          select: { slug: true, title: true, status: true, storeOnly: true },
        },
      },
      orderBy: { sku: 'asc' },
    });
    return rows.map((row) => ({
      id: toId<'Variant'>(row.id),
      productId: toId<'Product'>(row.productId),
      productSlug: row.product.slug,
      productTitle: row.product.title,
      productStatus: row.product.status,
      storeOnly: row.product.storeOnly,
      sku: row.sku,
      options: row.options as VariantOptions,
      status: row.status,
      weightGrams: row.weightGrams,
      lengthCm: row.lengthCm?.toNumber() ?? null,
      widthCm: row.widthCm?.toNumber() ?? null,
      heightCm: row.heightCm?.toNumber() ?? null,
    }));
  }
}

function toProductView(
  row: Omit<ProductRow, 'description'> & { description?: string | null },
): AdminProductView {
  return {
    id: toId<'Product'>(row.id),
    title: row.title,
    slug: row.slug,
    ...(row.description === undefined ? {} : { description: row.description }),
    brand:
      row.brand === null
        ? null
        : { id: toId<'Brand'>(row.brand.id), name: row.brand.name },
    categories: row.categories.map(({ category }) => ({
      id: toId<'Category'>(category.id),
      name: category.name,
    })),
    status: row.status,
    storeOnly: row.storeOnly,
    variants: row.variants.map((variant) => ({
      id: toId<'Variant'>(variant.id),
      sku: variant.sku,
      gtin: variant.gtin,
      options: variant.options as VariantOptions,
      status: variant.status,
      weightGrams: variant.weightGrams,
      lengthCm: variant.lengthCm?.toNumber() ?? null,
      widthCm: variant.widthCm?.toNumber() ?? null,
      heightCm: variant.heightCm?.toNumber() ?? null,
    })),
    images: row.images.map((image) => ({
      id: image.id,
      storageKey: image.storageKey,
      altText: image.altText,
      position: image.position,
      variantId:
        image.variantId === null ? null : toId<'Variant'>(image.variantId),
    })),
    publishedAt: row.publishedAt,
    firstPublishedAt: row.firstPublishedAt,
    archivedAt: row.archivedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCategoryView(row: CategoryRow): CategoryView {
  const { _count, ...fields } = row;
  return {
    ...fields,
    id: toId<'Category'>(row.id),
    parentId: row.parentId === null ? null : toId<'Category'>(row.parentId),
    productCount: _count.products,
    childCount: _count.children,
  };
}

function toBrandView(row: BrandRow): BrandView {
  const { _count, ...fields } = row;
  return {
    ...fields,
    id: toId<'Brand'>(row.id),
    productCount: _count.products,
  };
}
