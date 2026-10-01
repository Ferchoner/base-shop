import { Injectable } from '@nestjs/common';
import {
  NotFoundError,
  type Page,
  pageOffset,
  type PageRequest,
  type SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  StockItemId,
  StockLevel,
  StockMovement,
  VariantId,
} from '../domain/stock.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { CatalogVariants, type VariantLabel } from './catalog-variants.js';
import {
  InventoryQueries,
  type MovementFilter,
  type MovementPosition,
  type StockSortField,
} from './inventory.queries.js';

/** `StockItem` of API_SPEC.md §13. */
export interface StockItemView extends StockLevel {
  readonly sku: string;
  readonly productTitle: string;
  /** `onHand - reserved` (BR-INV-01). */
  readonly available: number;
}

export function stockItemView(
  stock: StockLevel,
  labels: ReadonlyMap<VariantId, VariantLabel>,
): StockItemView {
  const label = labels.get(stock.variantId);
  // Variants are never deleted (ADR-0038), so every stock item has one.
  if (label === undefined) {
    throw new Error(`Stock item ${stock.id} has no variant in Catalog`);
  }
  return { ...stock, ...label, available: stock.onHand - stock.reserved };
}

export interface StockListFilter {
  readonly variantId?: VariantId;
  /** Exact, whatever its case. */
  readonly sku?: string;
  /** Part of the SKU or of the product title, whatever its case. */
  readonly q?: string;
  readonly warehouseId?: WarehouseId;
  readonly availableMax?: number;
}

const intersect = (
  current: readonly VariantId[] | undefined,
  next: readonly VariantId[],
): VariantId[] =>
  current === undefined ? [...next] : current.filter((id) => next.includes(id));

/**
 * The stock listing and the movements of a stock item (UC-INV-04, ADR-0127). Inventory keeps no copy of SKUs
 * or titles: Catalog's facade gives them on every page, and resolves `sku` and `q` into variant IDs that
 * Inventory filters by, so totals stay right. Sorting by SKU, which only Catalog knows, sorts every stock item
 * of the filter in memory in Catalog's order and then takes the page: its cost grows with the stock items of
 * the filter, fine at the scale of the MVP.
 */
@Injectable()
export class StockListing {
  constructor(
    private readonly queries: InventoryQueries,
    private readonly variants: CatalogVariants,
  ) {}

  async list(
    filter: StockListFilter,
    sort: readonly SortOrder<StockSortField>[],
    page: PageRequest,
  ): Promise<Page<StockItemView>> {
    const variantIds = await this.matchingVariants(filter);
    if (variantIds?.length === 0) return { items: [], totalItems: 0 };
    const stockFilter = {
      variantIds,
      warehouseId: filter.warehouseId,
      availableMax: filter.availableMax,
    };
    if (sort.some(({ field }) => field === 'sku')) {
      const all = await this.queries.allStock(stockFilter);
      const labels = await this.variants.labels(
        all.map(({ variantId }) => variantId),
      );
      const items = [...all]
        .sort(comparing(sort, labels))
        .slice(pageOffset(page), pageOffset(page) + page.pageSize);
      return {
        items: items.map((stock) => stockItemView(stock, labels)),
        totalItems: all.length,
      };
    }
    const found = await this.queries.pageOfStock(
      stockFilter,
      sort as readonly SortOrder<'available' | 'updatedAt'>[],
      page,
    );
    const labels = await this.variants.labels(
      found.items.map(({ variantId }) => variantId),
    );
    return {
      items: found.items.map((stock) => stockItemView(stock, labels)),
      totalItems: found.totalItems,
    };
  }

  /** A page of movements of a stock item, newest first, and where the next page starts, if any. */
  async movements(
    stockItemId: StockItemId,
    filter: MovementFilter,
    position: MovementPosition | null,
    limit: number,
  ): Promise<{ movements: StockMovement[]; next: MovementPosition | null }> {
    if ((await this.queries.findStock(stockItemId)) === null) {
      throw new NotFoundError('StockItem', stockItemId);
    }
    const found = await this.queries.listMovements(
      stockItemId,
      filter,
      position,
      limit + 1,
    );
    const movements = found.slice(0, limit);
    const last = movements.at(-1);
    return {
      movements,
      next:
        found.length > limit && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : null,
    };
  }

  /** The variants the filter allows, or `undefined` when it does not limit them. */
  private async matchingVariants(
    filter: StockListFilter,
  ): Promise<VariantId[] | undefined> {
    let ids: VariantId[] | undefined =
      filter.variantId === undefined ? undefined : [filter.variantId];
    if (filter.sku !== undefined) {
      const found = await this.variants.findBySku(filter.sku);
      ids = intersect(ids, found === null ? [] : [found]);
    }
    if (filter.q !== undefined) {
      ids = intersect(ids, await this.variants.search(filter.q));
    }
    return ids;
  }
}

/** Sorts by the requested fields, SKUs in Catalog's order, and by ID last so pages never overlap. */
function comparing(
  sort: readonly SortOrder<StockSortField>[],
  labels: ReadonlyMap<VariantId, VariantLabel>,
): (a: StockLevel, b: StockLevel) => number {
  const rank = new Map([...labels.keys()].map((id, index) => [id, index]));
  const value = (stock: StockLevel, field: StockSortField): number => {
    if (field === 'sku') return rank.get(stock.variantId) ?? 0;
    if (field === 'available') return stock.onHand - stock.reserved;
    return stock.updatedAt.getTime();
  };
  return (a, b) => {
    for (const { field, direction } of sort) {
      const difference = value(a, field) - value(b, field);
      if (difference !== 0)
        return direction === 'asc' ? difference : -difference;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
