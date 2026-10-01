import type {
  AdjustmentReason,
  StockLevel,
  StockMovement,
  StockMovementId,
  VariantId,
} from './stock.js';
import type { WarehouseId } from './warehouse.js';

/** A change of `onHand` and the movement that records it. */
export interface StockEntry {
  readonly movementId: StockMovementId;
  readonly warehouseId: WarehouseId;
  readonly variantId: VariantId;
  /** Signed. */
  readonly quantity: number;
  readonly note: string | null;
  readonly actorId: string;
  /** When it happened, as the application's clock says (DEVELOPMENT_GUIDE.md). */
  readonly at: Date;
}

/** The stock after a change and the movement written with it. */
export interface StockChange {
  readonly stock: StockLevel;
  readonly movement: StockMovement;
}

/**
 * `stock_items` and `stock_movements`, always through the active transaction. Each change is one conditional
 * atomic `UPDATE`, without `version`, and writes its movement in the same transaction (DATABASE.md §12,
 * BR-INV-13). An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class StockLedgerRepository {
  /** Adds a receipt, creating the stock item of the variant in the warehouse on its first one (UC-INV-02). */
  abstract receive(entry: StockEntry): Promise<StockChange>;

  /**
   * Applies an adjustment (UC-INV-03), creating the stock item if needed; `null`, with nothing written, when
   * it would leave `onHand` below `reserved` or zero (BR-INV-01).
   */
  abstract adjust(
    entry: StockEntry & { readonly reasonCode: AdjustmentReason },
  ): Promise<StockChange | null>;
}
