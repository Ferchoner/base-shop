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
  type BrandFilter,
  type BrandSortField,
  type BrandView,
  CatalogQueries,
  type CategoryView,
} from '../application/catalog.queries.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';

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

type CategoryRow = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_FIELDS;
}>;
type BrandRow = Prisma.BrandGetPayload<{ select: typeof BRAND_FIELDS }>;

/** Read models of categories and brands (ADR-0120), straight from `categories` and `brands`. */
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
