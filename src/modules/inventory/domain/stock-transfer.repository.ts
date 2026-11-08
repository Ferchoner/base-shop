import type { StockTransfer, StockTransferId } from './stock-transfer.js';

/**
 * Persistence of transfers between warehouses (DATABASE.md §6.7, ADR-0172), always in the transaction of the
 * caller. An abstract class rather than an interface, so it can be the dependency injection token without
 * depending on NestJS.
 */
export abstract class StockTransferRepository {
  /** Saves a new transfer with its lines; the database gives it the next number of its folio, which is answered. */
  abstract insert(transfer: StockTransfer, now: Date): Promise<number>;

  /** The transfer with this ID, its row locked until the transaction ends; `null` if it does not exist. */
  abstract lock(id: StockTransferId): Promise<StockTransfer | null>;

  /**
   * Writes the status of a transfer and counts one more version, only over the version it read.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(transfer: StockTransfer, now: Date): Promise<void>;
}
