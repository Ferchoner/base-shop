import type { Warehouse, WarehouseId } from './warehouse.js';

/**
 * `warehouses`. An abstract class rather than an interface, so it can be the dependency injection token
 * without depending on NestJS.
 */
export abstract class WarehouseRepository {
  abstract find(id: WarehouseId): Promise<Warehouse | null>;

  /** The active warehouse: in the MVP, the only one (ADR-0081). */
  abstract findActive(): Promise<Warehouse | null>;

  abstract save(warehouse: Warehouse): Promise<void>;
}
