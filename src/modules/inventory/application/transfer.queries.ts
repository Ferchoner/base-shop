import type { Page, PageRequest } from '../../../shared-kernel/index.js';
import type { VariantId } from '../domain/stock.js';
import type {
  StockTransferId,
  StockTransferSnapshot,
  TransferKind,
  TransferReason,
  TransferStatus,
} from '../domain/stock-transfer.js';
import type { WarehouseId } from '../domain/warehouse.js';

/** Transfers and loans to list (ADR-0172). */
export interface TransferFilter {
  readonly kind?: TransferKind;
  /** Transfers that leave from or arrive at this warehouse. */
  readonly warehouseId?: WarehouseId;
  /** Transfers with a line of this variant. */
  readonly variantId?: VariantId;
  readonly reason?: TransferReason;
  readonly status?: TransferStatus;
  /** Recorded at this moment or later. */
  readonly from?: Date;
  /** Recorded at this moment or earlier. */
  readonly to?: Date;
  /** `true`, only the open loans whose time to come back passed by `now`; `false`, every other one. */
  readonly overdue?: boolean;
  /** The moment `overdue` is measured at; the use case sets it from its clock. */
  readonly now?: Date;
}

/**
 * Read models of transfers, from Inventory's own tables (ADR-0172). An abstract class rather than an interface,
 * so it can be the dependency injection token without depending on NestJS.
 */
export abstract class TransferQueries {
  /** A page of transfers, the most recent first (by when they were recorded, then their number). */
  abstract pageOfTransfers(
    filter: TransferFilter,
    page: PageRequest,
  ): Promise<Page<StockTransferSnapshot>>;

  /** The transfer with this ID and its lines; `null` if it does not exist. */
  abstract findTransfer(
    id: StockTransferId,
  ): Promise<StockTransferSnapshot | null>;
}
