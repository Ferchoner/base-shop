import type {
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  StockItemId,
  StockLevel,
  StockMovement,
  StockMovementType,
  VariantId,
} from '../domain/stock.js';
import type {
  WarehouseAddress,
  WarehouseId,
  WarehouseStatus,
} from '../domain/warehouse.js';

export type {
  StockLevel,
  StockMovement,
  StockMovementType,
} from '../domain/stock.js';
export type { WarehouseAddress } from '../domain/warehouse.js';

/** `Warehouse` of API_SPEC.md §13. */
export interface WarehouseView {
  readonly id: WarehouseId;
  readonly code: string;
  readonly name: string;
  readonly address: WarehouseAddress | null;
  readonly status: WarehouseStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Stock items to list; the variants come from Catalog's search, already resolved to IDs. */
export interface StockFilter {
  /** Only these variants; an empty list matches nothing. */
  readonly variantIds?: readonly VariantId[];
  readonly warehouseId?: WarehouseId;
  /** At most this many available units, to find what is running out. */
  readonly availableMax?: number;
}

export type StockSortField = 'sku' | 'available' | 'updatedAt';

/** Stock movements to list. */
export interface MovementFilter {
  readonly types?: readonly StockMovementType[];
  readonly from?: Date;
  readonly to?: Date;
}

/** Where a page of movements starts: after this movement, newest first. */
export interface MovementPosition {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * Read models of Inventory, from its own tables only: SKUs and titles come from Catalog (ADR-0127). An
 * abstract class rather than an interface, so it can be the dependency injection token without depending on
 * NestJS.
 */
export abstract class InventoryQueries {
  abstract listWarehouses(): Promise<WarehouseView[]>;

  abstract findWarehouse(id: WarehouseId): Promise<WarehouseView | null>;

  /** A page of stock items, sorted in the database: by available units or by the last change. */
  abstract pageOfStock(
    filter: StockFilter,
    sort: readonly SortOrder<'available' | 'updatedAt'>[],
    page: PageRequest,
  ): Promise<Page<StockLevel>>;

  /** Every stock item of the filter, unsorted: to sort by SKU, which only Catalog knows. */
  abstract allStock(filter: StockFilter): Promise<StockLevel[]>;

  abstract findStock(id: StockItemId): Promise<StockLevel | null>;

  /** Units available (`onHand - reserved`) of each variant with a stock item in the warehouse. */
  abstract availableUnits(
    warehouseId: WarehouseId,
    variantIds: readonly VariantId[],
  ): Promise<ReadonlyMap<VariantId, number>>;

  /**
   * Up to `limit` movements of a stock item, newest first (by `createdAt`, then ID), after `position` when
   * given.
   */
  abstract listMovements(
    stockItemId: StockItemId,
    filter: MovementFilter,
    position: MovementPosition | null,
    limit: number,
  ): Promise<StockMovement[]>;
}
