import {
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
} from '../../../shared-kernel/index.js';

export type ShipmentId = Id<'Shipment'>;

/** An order of Ordering, known here only by its ID (ADR-0005). */
export type OrderId = Id<'Order'>;

/** A line of an order of Ordering, known here only by its ID. */
export type OrderLineId = Id<'OrderLine'>;

/** The warehouse of Inventory the shipment leaves from. */
export type WarehouseId = Id<'Warehouse'>;

/**
 * BR-SHP-09: PENDING → DISPATCHED → DELIVERED | DELIVERY_FAILED; DELIVERY_FAILED → RETURNED. A shipment of an order
 * cancelled before it left becomes CANCELLED (ADR-0140).
 */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'DISPATCHED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNED',
  'CANCELLED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Where a shipment goes: the shipping address of its order, as the order keeps it (ADR-0057). */
export interface ShipmentAddress {
  readonly recipientName: string;
  readonly phone: string;
  readonly street: string;
  readonly exteriorNumber: string;
  readonly interiorNumber: string | null;
  readonly neighborhood: string;
  readonly postalCode: string;
  readonly stateCode: string;
  readonly stateName: string;
  readonly municipalityCode: string;
  readonly municipalityName: string;
  readonly city: string | null;
  readonly references: string | null;
  readonly country: string;
}

/** What a shipment carries of a line of its order, with what the staff needs to pack it (ADR-0140). */
export interface ShipmentItem {
  readonly orderLineId: OrderLineId;
  readonly sku: string;
  readonly productName: string;
  readonly quantity: number;
}

export interface ShipmentSnapshot {
  readonly id: ShipmentId;
  readonly orderId: OrderId;
  /** The public code of the order, without dash, copied when the shipment is created (ADR-0140). */
  readonly orderCode: string;
  readonly warehouseId: WarehouseId;
  readonly status: ShipmentStatus;
  readonly destination: ShipmentAddress;
  readonly items: readonly ShipmentItem[];
  readonly carrierName: string | null;
  readonly trackingNumber: string | null;
  /** Delivered by the store itself, without carrier nor tracking number (ADR-0078). */
  readonly ownDelivery: boolean;
  readonly dispatchedAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly failedAt: Date | null;
  readonly returnedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly version: number;
}

/**
 * The shipment of an order (DOMAIN_MODEL.md, Shipping), managed by hand by the staff (BR-SHP-05, ADR-0041). An order
 * has one shipment (BR-SHP-02), created when it is paid (BR-SHP-01). It keeps what it needs of its order, because
 * Shipping never reads Ordering (ADR-0140).
 */
export class Shipment {
  private changed = false;

  private constructor(private state: ShipmentSnapshot) {}

  /**
   * The shipment of an order just paid (UC-SHI-03): PENDING, to its shipping address, with every line of it.
   *
   * @throws InvalidValueError without items, or with a quantity that is not a whole number above zero.
   */
  static create(input: {
    id: ShipmentId;
    orderId: OrderId;
    orderCode: string;
    warehouseId: WarehouseId;
    destination: ShipmentAddress;
    items: readonly ShipmentItem[];
  }): Shipment {
    if (input.items.length === 0) {
      throw new InvalidValueError('A shipment carries at least one item');
    }
    for (const { quantity } of input.items) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new InvalidValueError(
          'A shipment carries a whole number of units above zero of each item',
        );
      }
    }
    const shipment = new Shipment({
      id: input.id,
      orderId: input.orderId,
      orderCode: input.orderCode,
      warehouseId: input.warehouseId,
      status: 'PENDING',
      destination: input.destination,
      items: input.items,
      carrierName: null,
      trackingNumber: null,
      ownDelivery: false,
      dispatchedAt: null,
      deliveredAt: null,
      failedAt: null,
      returnedAt: null,
      cancelledAt: null,
      version: 1,
    });
    shipment.changed = true;
    return shipment;
  }

  /** A shipment as it was saved. */
  static restore(snapshot: ShipmentSnapshot): Shipment {
    return new Shipment(snapshot);
  }

  get snapshot(): ShipmentSnapshot {
    return this.state;
  }

  get id(): ShipmentId {
    return this.state.id;
  }

  get status(): ShipmentStatus {
    return this.state.status;
  }

  get version(): number {
    return this.state.version;
  }

  /** Whether anything changed since it was read, so there is something to save. */
  get hasChanges(): boolean {
    return this.changed;
  }

  /**
   * The staff records the carrier and the tracking number (UC-SHI-04, BR-SHP-04): while PENDING, or once DISPATCHED
   * by a carrier, to correct them; never in a shipment dispatched as own delivery (ADR-0078).
   *
   * @returns false, changing nothing, when they are the ones it has.
   * @throws InvalidStateTransitionError in any other status.
   */
  recordTracking(carrierName: string, trackingNumber: string): boolean {
    const editable =
      this.state.status === 'PENDING' ||
      (this.state.status === 'DISPATCHED' && !this.state.ownDelivery);
    if (!editable) {
      throw new InvalidStateTransitionError(
        this.state.status,
        'record the tracking',
      );
    }
    if (
      this.state.carrierName === carrierName &&
      this.state.trackingNumber === trackingNumber
    ) {
      return false;
    }
    this.state = { ...this.state, carrierName, trackingNumber };
    this.changed = true;
    return true;
  }

  /**
   * Its order was cancelled before it left (UC-ORD-07, ADR-0140): CANCELLED, final.
   *
   * @throws InvalidStateTransitionError unless PENDING: an order whose shipment left is not cancelled (BR-CAN-01).
   */
  cancel(now: Date): void {
    if (this.state.status !== 'PENDING') {
      throw new InvalidStateTransitionError(this.state.status, 'cancel');
    }
    this.state = { ...this.state, status: 'CANCELLED', cancelledAt: now };
    this.changed = true;
  }
}
