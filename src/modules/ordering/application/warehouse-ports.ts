import type { WarehouseId } from '../domain/order.js';

// Ordering's application layer cannot import other modules (ADR-0103): this port says what the views of an order
// need of the warehouses, and an adapter in its infrastructure answers it with the facade of Inventory. An abstract
// class rather than an interface, so it can be the dependency injection token without depending on NestJS.

/** The warehouse the goods of an order left from, as the ticket shows it (ADR-0163). */
export interface FulfillmentWarehouse {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** The warehouses of Inventory. */
export abstract class OrderWarehouses {
  /** A warehouse, active or not; `null` when it does not exist. */
  abstract warehouse(id: WarehouseId): Promise<FulfillmentWarehouse | null>;
}
