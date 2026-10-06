import type { Warehouse, WarehouseId } from './warehouse.js';

/**
 * `warehouses`. An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class WarehouseRepository {
  abstract find(id: WarehouseId): Promise<Warehouse | null>;

  /**
   * Every active warehouse, locked until the transaction ends, in ascending ID order: a deactivation waits for
   * the reservations and receipts under way in them, and for another deactivation (ADR-0160).
   */
  abstract lockActive(): Promise<Warehouse[]>;

  /**
   * The warehouse, sharing its lock with other entries of stock until the transaction ends, so it cannot be
   * deactivated meanwhile (ADR-0160); `null` when it does not exist.
   */
  abstract lockForStock(id: WarehouseId): Promise<Warehouse | null>;

  /** Units the stock of the warehouse holds for orders (`reserved`). */
  abstract reservedUnits(id: WarehouseId): Promise<number>;

  /** @throws DuplicateValueError on `code` when another warehouse has it. */
  abstract insert(warehouse: Warehouse): Promise<void>;

  abstract save(warehouse: Warehouse): Promise<void>;
}
