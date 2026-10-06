import type { Warehouse, WarehouseId } from './warehouse.js';

/**
 * `warehouses`. An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class WarehouseRepository {
  abstract find(id: WarehouseId): Promise<Warehouse | null>;

  /** The first active warehouse, by priority and then code (ADR-0160); `null` when none is active. */
  abstract firstActive(): Promise<Warehouse | null>;

  abstract save(warehouse: Warehouse): Promise<void>;
}
