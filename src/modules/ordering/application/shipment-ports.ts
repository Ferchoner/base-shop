import type { Order, OrderAddress, OrderId } from '../domain/order.js';

/** The shipment of an order, as the order shows it (API_SPEC.md §8.8); its ID and version only for the staff (§8.9). */
export interface OrderShipment {
  readonly id: string;
  readonly status: string;
  readonly carrierName: string | null;
  readonly trackingNumber: string | null;
  readonly ownDelivery: boolean;
  readonly dispatchedAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly version: number;
  /** The warehouse it leaves from, only for the staff (ADR-0160). */
  readonly warehouseId: string;
}

/**
 * The shipments of Shipping (UC-SHI-03, ADR-0140). Ordering hands over what the shipment needs of its order,
 * because Shipping never reads Ordering; every operation joins the transaction of the caller.
 */
export abstract class OrderShipments {
  /**
   * Creates the shipment of an order just paid, PENDING, from the warehouse its confirmed stock left, with every
   * line of it; an order that has one keeps it (BR-SHP-01, BR-SHP-02, ADR-0160).
   */
  abstract createFor(order: Order): Promise<void>;

  /**
   * Cancels the shipment of an order being cancelled; nothing when it has none.
   *
   * @throws InvalidStateTransitionError when the shipment is no longer PENDING.
   */
  abstract cancel(orderId: OrderId): Promise<void>;

  /** Anonymizes the shipments of these orders, being anonymized; an order without one is skipped (ADR-0067). */
  abstract anonymize(orderIds: readonly OrderId[], at: Date): Promise<void>;

  /** Blocks the shipments of these orders, being blocked; an order without one is skipped (ADR-0070). */
  abstract block(orderIds: readonly OrderId[], at: Date): Promise<void>;

  /**
   * The destination of the shipment of an order as it was saved, also when blocked; `null` for an order without one.
   * Only for the blocked data of the order (ADR-0070, ADR-0152).
   */
  abstract destinationOf(orderId: OrderId): Promise<OrderAddress | null>;

  /** The shipments of these orders, by order; an order without one is left out. */
  abstract shipmentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, OrderShipment>>;
}
