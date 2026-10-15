import type {
  AdjustmentReason,
  RestockReason,
  StockItemId,
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

/** Units of a line of an order that come back to the stock (UC-INV-09, ADR-0052). */
export interface RestockEntry extends StockEntry {
  readonly reasonCode: RestockReason;
  readonly orderId: string;
  readonly orderLineId: string;
}

/**
 * Units of a variant an order took from one warehouse that can still come back: sold minus restocked there
 * (ADR-0160).
 */
export interface RestockOrigin {
  readonly warehouseId: WarehouseId;
  readonly variantId: VariantId;
  readonly units: number;
}

/** The stock of a variant in a warehouse. */
export interface StockKey {
  readonly variantId: VariantId;
  readonly warehouseId: WarehouseId;
}

/** A receipt of a bulk import, with the `onHand` it leaves, computed on the locked stock item (ADR-0164). */
export interface ComputedReceipt {
  readonly movementId: StockMovementId;
  readonly stockItemId: StockItemId;
  readonly quantity: number;
  readonly onHandAfter: number;
  readonly note: string | null;
  readonly actorId: string;
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
   * The stock items of these variants in these warehouses, for a bulk import of receipts (ADR-0164): it creates
   * those that do not exist, with no units, and locks them all until the transaction ends in ascending ID order,
   * like reservations (BR-INV-14).
   */
  abstract lockItems(
    keys: readonly StockKey[],
    at: Date,
  ): Promise<StockLevel[]>;

  /**
   * Writes the receipts of a bulk import on their locked stock items (ADR-0164): one RECEIPT movement each, in
   * their order, and the `onHand` of the last one of each stock item, with a few statements that take arrays.
   */
  abstract writeReceipts(
    receipts: readonly ComputedReceipt[],
    at: Date,
  ): Promise<void>;

  /**
   * Applies an adjustment (UC-INV-03), creating the stock item if needed; `null`, with nothing written, when
   * it would leave `onHand` below `reserved` or zero (BR-INV-01).
   */
  abstract adjust(
    entry: StockEntry & { readonly reasonCode: AdjustmentReason },
  ): Promise<StockChange | null>;

  /**
   * Brings units of lines of an order back to the stock (UC-INV-09): one RESTOCK movement per entry, in the
   * warehouse of the entry, updating the stock items in ascending ID order, like reservations (BR-INV-14).
   */
  abstract restock(entries: readonly RestockEntry[]): Promise<StockMovement[]>;

  /**
   * Where the stock of an order left from (ADR-0160): for each warehouse and variant its SALE movements took
   * units from, the units that can still come back there, by priority of the warehouse and then its code.
   */
  abstract originsOf(orderId: string): Promise<RestockOrigin[]>;

  /** The units restocked so far of each of these lines of orders; a line never restocked is left out. */
  abstract restockedOf(
    orderLineIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
}
