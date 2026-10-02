import type { OrderId, Shipment, ShipmentId } from './shipment.js';

/**
 * Persistence of shipments (DATABASE.md §10.2 and §10.3). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class ShipmentRepository {
  /**
   * Saves a new shipment with its items.
   *
   * @returns false, writing nothing, when its order already has one (BR-SHP-02), so creating it is idempotent.
   */
  abstract insert(shipment: Shipment, now: Date): Promise<boolean>;

  /** The shipment with this ID, locked until the transaction ends; `null` if it does not exist. */
  abstract lock(id: ShipmentId): Promise<Shipment | null>;

  /** The shipment of the order, locked until the transaction ends; `null` if the order has none. */
  abstract lockByOrder(orderId: OrderId): Promise<Shipment | null>;

  /**
   * Writes what changed in a locked shipment and counts one more version.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(shipment: Shipment, now: Date): Promise<void>;
}
