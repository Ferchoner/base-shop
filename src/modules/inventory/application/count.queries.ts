import type { Page, PageRequest } from '../../../shared-kernel/index.js';
import type {
  CountLine,
  CountStatus,
  StockCountId,
  StockCountSnapshot,
} from '../domain/stock-count.js';
import type { WarehouseId } from '../domain/warehouse.js';

/** Count sheets to list (ADR-0173). */
export interface CountListFilter {
  readonly warehouseId?: WarehouseId;
  readonly status?: CountStatus;
}

/** A sheet in the listing: without its lines, with how many it has and how many are counted. */
export interface CountSummary extends StockCountSnapshot {
  readonly lineCount: number;
  readonly countedCount: number;
}

/** A sheet and its lines, in their order on the sheet. */
export interface CountRecord extends CountSummary {
  readonly lines: readonly CountLine[];
}

/**
 * Read models of count sheets, from Inventory's own tables (ADR-0173). An abstract class rather than an interface,
 * so it can be the dependency injection token without depending on NestJS.
 */
export abstract class CountQueries {
  /** A page of sheets, the most recent first (by their number). */
  abstract pageOfCounts(
    filter: CountListFilter,
    page: PageRequest,
  ): Promise<Page<CountSummary>>;

  /** The sheet with this ID and its lines; `null` if it does not exist. */
  abstract findCount(id: StockCountId): Promise<CountRecord | null>;
}
