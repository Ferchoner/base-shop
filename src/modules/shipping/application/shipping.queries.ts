import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  OrderId,
  ShipmentDestination,
  ShipmentId,
  ShipmentItem,
  ShipmentStatus,
  WarehouseId,
} from '../domain/shipment.js';
import type { ShippingMethodId } from '../domain/shipping-method.js';

/** `ShippingMethod` of API_SPEC.md §17. */
export interface ShippingMethodView {
  readonly id: ShippingMethodId;
  readonly name: string;
  readonly flatFee: Money;
  readonly freeShippingThreshold: Money | null;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
  readonly isActive: boolean;
  readonly version: number;
  readonly updatedAt: Date;
}

/**
 * The shipment of an order, as the order shows it to its buyer and to the staff (API_SPEC.md §8.8 and 8.9): the
 * buyer never sees its ID nor its version.
 */
export interface OrderShipmentView {
  readonly id: ShipmentId;
  readonly status: ShipmentStatus;
  readonly carrierName: string | null;
  readonly trackingNumber: string | null;
  readonly ownDelivery: boolean;
  readonly dispatchedAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly version: number;
  /** The warehouse it leaves from: the one its order was reserved in (ADR-0160). */
  readonly warehouseId: WarehouseId;
}

/** `AdminShipment` of API_SPEC.md §17. */
export interface ShipmentView extends OrderShipmentView {
  readonly orderId: OrderId;
  /** Without dash. */
  readonly orderCode: string;
  /** Whole until its order is anonymized (ADR-0067). */
  /** Without who receives it nor where exactly once its order is blocked or anonymized (ADR-0070). */
  readonly destination: ShipmentDestination;
  /** When the data of its order was blocked (ADR-0070); `null` until then. */
  readonly blockedAt: Date | null;
  readonly items: readonly ShipmentItem[];
  readonly failedAt: Date | null;
  readonly returnedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly failureNote: string | null;
  readonly returnNote: string | null;
  readonly createdAt: Date;
}

export interface ShipmentFilter {
  /** Any of these. */
  readonly status?: readonly ShipmentStatus[];
  readonly orderId?: OrderId;
  /** The public code of the order, with or without dash and in any case, or the tracking number, in any case. */
  readonly q?: string;
  /** Created at or after. */
  readonly createdFrom?: Date;
  /** Created at or before. */
  readonly createdTo?: Date;
  /** Leaving from this warehouse (ADR-0160). */
  readonly warehouseId?: WarehouseId;
}

export type ShipmentSortField = 'createdAt' | 'dispatchedAt';

/**
 * Read models of Shipping. An abstract class rather than an interface, so it can be the dependency injection
 * token without depending on NestJS.
 */
export abstract class ShippingQueries {
  abstract findActiveMethod(): Promise<ShippingMethodView | null>;

  /** The shipments of these orders, by order; an order without one is left out. */
  abstract shipmentsOf(
    orderIds: readonly OrderId[],
  ): Promise<ReadonlyMap<OrderId, OrderShipmentView>>;

  abstract findShipment(id: ShipmentId): Promise<ShipmentView | null>;

  /**
   * The destination of the shipment of an order as it was saved, also when blocked; `null` for an order without one.
   * Only for the staff who reads the blocked data of an order, which Ordering audits (ADR-0070, ADR-0152).
   */
  abstract destinationOf(orderId: OrderId): Promise<ShipmentDestination | null>;

  /** Shipments for the staff (UC-SHI-08); ties are broken by ID. */
  abstract listShipments(
    filter: ShipmentFilter,
    sort: readonly SortOrder<ShipmentSortField>[],
    page: PageRequest,
  ): Promise<Page<ShipmentView>>;
}
