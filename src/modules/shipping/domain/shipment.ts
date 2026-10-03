import {
  DomainError,
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

/** The fields of a destination that tell who receives it and where exactly: anonymization removes them (ADR-0067). */
type IdentifyingField =
  | 'recipientName'
  | 'phone'
  | 'street'
  | 'exteriorNumber'
  | 'interiorNumber'
  | 'neighborhood'
  | 'city'
  | 'references';

/**
 * The destination of a shipment whose order was anonymized (ADR-0067): it keeps the state, the municipality, the
 * postal code and the country; the rest is `null`.
 */
export type AnonymizedDestination = Omit<ShipmentAddress, IdentifyingField> & {
  readonly [Field in IdentifyingField]: null;
};

/** Where a shipment goes, whole until its order is anonymized. */
export type ShipmentDestination = ShipmentAddress | AnonymizedDestination;

/**
 * A destination without who receives it nor where exactly: the state, the municipality, the postal code and the
 * country. What an anonymized shipment keeps, and what a blocked one shows (ADR-0067, ADR-0070).
 */
export function withoutIdentifyingFields(
  destination: ShipmentDestination,
): AnonymizedDestination {
  return {
    recipientName: null,
    phone: null,
    street: null,
    exteriorNumber: null,
    interiorNumber: null,
    neighborhood: null,
    postalCode: destination.postalCode,
    stateCode: destination.stateCode,
    stateName: destination.stateName,
    municipalityCode: destination.municipalityCode,
    municipalityName: destination.municipalityName,
    city: null,
    references: null,
    country: destination.country,
  };
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
  readonly destination: ShipmentDestination;
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
  /** Why the delivery failed, as the staff wrote it (ADR-0141). */
  readonly failureNote: string | null;
  /** What came back, as the staff wrote it (ADR-0141). */
  readonly returnNote: string | null;
  /** When the data of who receives it was removed, with its order (ADR-0067); `null` until then. */
  readonly anonymizedAt: Date | null;
  /** When the data of who receives it was blocked, with its order (ADR-0070); `null` until then. */
  readonly blockedAt: Date | null;
  readonly version: number;
}

/**
 * The tracking of a shipment does not fit the way it leaves (BR-SHP-04, ADR-0078): by a carrier without its carrier
 * and tracking number, or as own delivery with them. A validation error of `ownDelivery` (API_SPEC.md §17).
 */
export class DispatchTrackingError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(problem: 'trackingRequired' | 'trackingNotAllowed') {
    super(
      problem === 'trackingRequired'
        ? 'A shipment leaves by a carrier only with its carrier and tracking number'
        : 'A shipment leaves as own delivery only without carrier nor tracking number',
      {
        errors: [
          {
            field: 'ownDelivery',
            code: problem,
            message:
              problem === 'trackingRequired'
                ? 'Captura la paquetería y la guía antes de despachar por paquetería.'
                : 'Una entrega propia no lleva paquetería ni guía: quítalas antes de despachar.',
          },
        ],
      },
    );
  }
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
      failureNote: null,
      returnNote: null,
      anonymizedAt: null,
      blockedAt: null,
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
   * The staff removes a carrier and tracking number recorded by mistake, so the shipment can leave as own delivery
   * (ADR-0141): only while PENDING, because a shipment that left by a carrier keeps them (BR-SHP-04).
   *
   * @returns false, changing nothing, when it has none.
   * @throws InvalidStateTransitionError unless PENDING.
   */
  removeTracking(): boolean {
    this.assertStatus('PENDING', 'remove the tracking');
    if (this.state.carrierName === null && this.state.trackingNumber === null) {
      return false;
    }
    this.state = { ...this.state, carrierName: null, trackingNumber: null };
    this.changed = true;
    return true;
  }

  /**
   * The shipment leaves (UC-SHI-05, BR-SHP-04, ADR-0078): by a carrier, with its carrier and tracking number already
   * recorded, or as own delivery, without them.
   *
   * @throws InvalidStateTransitionError unless PENDING; DispatchTrackingError when its tracking does not fit.
   */
  dispatch(ownDelivery: boolean, now: Date): void {
    this.assertStatus('PENDING', 'dispatch');
    const { carrierName, trackingNumber } = this.state;
    if (!ownDelivery && (carrierName === null || trackingNumber === null)) {
      throw new DispatchTrackingError('trackingRequired');
    }
    if (ownDelivery && (carrierName !== null || trackingNumber !== null)) {
      throw new DispatchTrackingError('trackingNotAllowed');
    }
    this.state = {
      ...this.state,
      status: 'DISPATCHED',
      ownDelivery,
      dispatchedAt: now,
    };
    this.changed = true;
  }

  /**
   * The customer received it (UC-SHI-06, BR-SHP-03): DELIVERED, final.
   *
   * @throws InvalidStateTransitionError unless DISPATCHED.
   */
  deliver(now: Date): void {
    this.assertStatus('DISPATCHED', 'deliver');
    this.state = { ...this.state, status: 'DELIVERED', deliveredAt: now };
    this.changed = true;
  }

  /**
   * It could not be delivered (UC-SHI-07, ADR-0053): DELIVERY_FAILED, with nothing retried, cancelled nor refunded.
   *
   * @throws InvalidStateTransitionError unless DISPATCHED.
   */
  failDelivery(note: string | null, now: Date): void {
    this.assertStatus('DISPATCHED', 'record the delivery failure');
    this.state = {
      ...this.state,
      status: 'DELIVERY_FAILED',
      failedAt: now,
      failureNote: note,
    };
    this.changed = true;
  }

  /**
   * The goods of a failed delivery came back (UC-SHI-09, ADR-0053): RETURNED, final; their stock comes back apart
   * (UC-INV-09).
   *
   * @throws InvalidStateTransitionError unless DELIVERY_FAILED.
   */
  markReturned(note: string | null, now: Date): void {
    this.assertStatus('DELIVERY_FAILED', 'mark returned');
    this.state = {
      ...this.state,
      status: 'RETURNED',
      returnedAt: now,
      returnNote: note,
    };
    this.changed = true;
  }

  /**
   * Its order was cancelled before it left (UC-ORD-07, ADR-0140): CANCELLED, final.
   *
   * @throws InvalidStateTransitionError unless PENDING: an order whose shipment left is not cancelled (BR-CAN-01).
   */
  cancel(now: Date): void {
    this.assertStatus('PENDING', 'cancel');
    this.state = { ...this.state, status: 'CANCELLED', cancelledAt: now };
    this.changed = true;
  }

  /**
   * Its order was anonymized (UC-IAM-19, ADR-0067): its destination keeps only the state, the municipality, the
   * postal code and the country. Its status and dates stay. An anonymized order has concluded, so its shipment never
   * moves again (ADR-0145).
   */
  anonymize(at: Date): void {
    this.state = {
      ...this.state,
      destination: withoutIdentifyingFields(this.state.destination),
      anonymizedAt: this.state.anonymizedAt ?? at,
    };
    this.changed = true;
  }

  /**
   * The data of its order was blocked (ADR-0070): its destination stays, hidden from the staff until it is anonymized.
   * A blocked order has concluded, so its shipment never moves again.
   */
  block(at: Date): void {
    if (this.state.blockedAt !== null) return;
    this.state = { ...this.state, blockedAt: at };
    this.changed = true;
  }

  private assertStatus(allowed: ShipmentStatus, action: string): void {
    if (this.state.status !== allowed) {
      throw new InvalidStateTransitionError(this.state.status, action);
    }
  }
}
