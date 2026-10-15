import type { Warehouse, WarehouseId } from './warehouse.js';

/**
 * `warehouses`. An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class WarehouseRepository {
  abstract find(id: WarehouseId): Promise<Warehouse | null>;

  /** The warehouses with these codes, in any status; a code no warehouse has is left out (ADR-0164). */
  abstract findByCodes(codes: readonly string[]): Promise<Warehouse[]>;

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

  /**
   * The warehouses, sharing their locks with other entries of stock until the transaction ends, in ascending ID
   * order, like `lockActive`, for a bulk import of receipts (ADR-0164); one that does not exist is left out.
   */
  abstract lockManyForStock(ids: readonly WarehouseId[]): Promise<Warehouse[]>;

  /** Units the stock of the warehouse holds for orders (`reserved`). */
  abstract reservedUnits(id: WarehouseId): Promise<number>;

  /** @throws DuplicateValueError on `code` when another warehouse has it. */
  abstract insert(warehouse: Warehouse): Promise<void>;

  abstract save(warehouse: Warehouse): Promise<void>;
}
