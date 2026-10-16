import {
  DuplicateValueError,
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  type Money,
  NotFoundError,
} from '../../../shared-kernel/index.js';

export type WorkOrderId = Id<'WorkOrder'>;

/** A warehouse of Inventory, known here only by its ID (ADR-0005): the one of the store that received the equipment. */
export type WarehouseId = Id<'Warehouse'>;

/** A staff member or a customer of Identity, known here only by its ID (ADR-0005). */
export type UserId = Id<'User'>;

/** An order of Ordering, known here only by its ID (ADR-0005): a counter sale that pays for a work order. */
export type OrderId = Id<'Order'>;

export type WorkOrderStatus =
  'RECEIVED' | 'DIAGNOSED' | 'IN_REPAIR' | 'READY' | 'DELIVERED' | 'CANCELLED';

export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  'RECEIVED',
  'DIAGNOSED',
  'IN_REPAIR',
  'READY',
  'DELIVERED',
  'CANCELLED',
];

/** The way forward of a work order (ADR-0166); it may skip steps, but never goes back. */
const FORWARD: readonly WorkOrderStatus[] = [
  'RECEIVED',
  'DIAGNOSED',
  'IN_REPAIR',
  'READY',
  'DELIVERED',
];

/** Statuses after which nothing changes: the note was printed and signed (ADR-0166). */
const CLOSED: readonly WorkOrderStatus[] = ['DELIVERED', 'CANCELLED'];

/** Maximum lengths of the texts of a work order (API_SPEC.md §25.2 and §25.5). */
export const WORK_ORDER_TEXT_LIMITS = {
  customerName: 120,
  customerEmail: 254,
  equipmentType: 60,
  equipmentBrand: 60,
  equipmentModel: 60,
  serialNumber: 60,
  accessories: 500,
  equipmentCondition: 1000,
  reportedFault: 2000,
  diagnosis: 4000,
  workPerformed: 4000,
  note: 500,
} as const;

/** The data of a work order that the staff writes and corrects (UC-WRK-01 and 03). */
export interface WorkOrderDetails {
  /** The registered customer it is linked to; the name and the phone are its own either way (ADR-0166). */
  readonly customerId: UserId | null;
  readonly customerName: string;
  /** 10 digits, as in the addresses (ADR-0113). */
  readonly customerPhone: string;
  /** Normalized: trimmed and in lowercase. */
  readonly customerEmail: string | null;
  readonly equipmentType: string;
  readonly equipmentBrand: string | null;
  readonly equipmentModel: string | null;
  readonly serialNumber: string | null;
  readonly accessories: string | null;
  /** How the equipment was when it was received. */
  readonly equipmentCondition: string | null;
  readonly reportedFault: string;
  readonly diagnosis: string | null;
  readonly workPerformed: string | null;
  /** Informative: the work order charges nothing (ADR-0165). */
  readonly estimatedCost: Money | null;
  readonly technicianId: UserId | null;
}

/** What the staff gives when the equipment is received: the diagnosis and the work come later. */
export type NewWorkOrderDetails = Omit<
  WorkOrderDetails,
  'diagnosis' | 'workPerformed'
>;

/** Corrections to a work order (UC-WRK-03). A missing field keeps its value; `null` clears an optional one. */
export type WorkOrderChanges = Partial<WorkOrderDetails>;

export interface WorkOrderSnapshot extends WorkOrderDetails {
  readonly id: WorkOrderId;
  readonly status: WorkOrderStatus;
  readonly warehouseId: WarehouseId;
  /** The staff member who received the equipment. */
  readonly receivedBy: UserId;
  readonly receivedAt: Date;
  /** When it was delivered or cancelled. */
  readonly closedAt: Date | null;
  /** The counter sales that pay for it, in the order they were linked (ADR-0167). */
  readonly sales: readonly WorkOrderSale[];
  readonly version: number;
}

/** A counter sale linked to a work order (UC-WRK-05, ADR-0167). */
export interface WorkOrderSale {
  readonly orderId: OrderId;
  /** The staff member who linked it. */
  readonly linkedBy: UserId;
  readonly linkedAt: Date;
}

/** An entry of the status history (`work_order_status_history`): who moved the work order, when and why. */
export interface WorkOrderStatusChange {
  /** `null` on reception. */
  readonly from: WorkOrderStatus | null;
  readonly to: WorkOrderStatus;
  readonly actorId: UserId;
  readonly note: string | null;
  readonly at: Date;
}

/**
 * The service note of the equipment a customer leaves in the store (ADR-0165, ADR-0166). It is received in
 * RECEIVED and moves forward through DIAGNOSED, IN_REPAIR and READY to DELIVERED, skipping steps if needed but
 * never going back; it is CANCELLED, with a note, from any status before DELIVERED. Delivered or cancelled, it
 * takes no more changes. Its folio comes from the database when it is saved. Counter sales that pay for it are linked
 * and unlinked while it is open (ADR-0167). Changes carry the `version` (optimistic locking).
 */
export class WorkOrder {
  private readonly changes: WorkOrderStatusChange[] = [];
  private readonly linked: WorkOrderSale[] = [];
  private readonly unlinked: OrderId[] = [];

  private constructor(private state: WorkOrderSnapshot) {}

  /** A work order for equipment just received (UC-WRK-01). */
  static receive(props: {
    id: WorkOrderId;
    details: NewWorkOrderDetails;
    warehouseId: WarehouseId;
    receivedBy: UserId;
    at: Date;
  }): WorkOrder {
    const workOrder = new WorkOrder({
      id: props.id,
      ...validDetails({
        ...props.details,
        diagnosis: null,
        workPerformed: null,
      }),
      status: 'RECEIVED',
      warehouseId: props.warehouseId,
      receivedBy: props.receivedBy,
      receivedAt: props.at,
      closedAt: null,
      sales: [],
      version: 1,
    });
    workOrder.changes.push({
      from: null,
      to: 'RECEIVED',
      actorId: props.receivedBy,
      note: null,
      at: props.at,
    });
    return workOrder;
  }

  static restore(snapshot: WorkOrderSnapshot): WorkOrder {
    return new WorkOrder(snapshot);
  }

  get id(): WorkOrderId {
    return this.state.id;
  }

  get status(): WorkOrderStatus {
    return this.state.status;
  }

  get version(): number {
    return this.state.version;
  }

  get snapshot(): WorkOrderSnapshot {
    return this.state;
  }

  /** The status changes since it was received or read, oldest first. */
  get statusChanges(): readonly WorkOrderStatusChange[] {
    return this.changes;
  }

  /** The sales linked and unlinked since it was read. */
  get saleChanges(): {
    readonly linked: readonly WorkOrderSale[];
    readonly unlinked: readonly OrderId[];
  } {
    return { linked: this.linked, unlinked: this.unlinked };
  }

  /**
   * Links a counter sale that pays for it (UC-WRK-05, ADR-0167). The caller checks that it is a sale of the store
   * that can still be paid.
   *
   * @throws InvalidStateTransitionError when it was delivered or cancelled; DuplicateValueError when it already has
   *   the sale.
   */
  linkSale(orderId: OrderId, staffId: UserId, at: Date): void {
    this.assertOpen('link a sale');
    if (this.state.sales.some((sale) => sale.orderId === orderId)) {
      throw new DuplicateValueError('orderId');
    }
    const sale = { orderId, linkedBy: staffId, linkedAt: at };
    this.state = { ...this.state, sales: [...this.state.sales, sale] };
    this.linked.push(sale);
  }

  /**
   * Unlinks a sale linked by mistake (UC-WRK-05, ADR-0167).
   *
   * @throws InvalidStateTransitionError when it was delivered or cancelled; NotFoundError when it does not have the
   *   sale.
   */
  unlinkSale(orderId: OrderId): void {
    this.assertOpen('unlink a sale');
    if (!this.state.sales.some((sale) => sale.orderId === orderId)) {
      throw new NotFoundError('Sale', orderId);
    }
    this.state = {
      ...this.state,
      sales: this.state.sales.filter((sale) => sale.orderId !== orderId),
    };
    this.unlinked.push(orderId);
  }

  /**
   * Corrects its data and records the diagnosis and the work done (UC-WRK-03).
   *
   * @throws InvalidStateTransitionError when it was delivered or cancelled.
   */
  edit(changes: WorkOrderChanges): void {
    this.assertOpen('edit');
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as WorkOrderChanges;
    this.state = {
      ...this.state,
      ...validDetails({ ...this.state, ...defined }),
    };
  }

  /**
   * Moves it to another status (UC-WRK-04): forward, skipping steps if needed, or to CANCELLED with a note.
   *
   * @throws InvalidStateTransitionError when it was delivered or cancelled, or the status is not ahead of the
   *   current one; InvalidValueError when a cancellation has no note.
   */
  moveTo(
    to: WorkOrderStatus,
    actorId: UserId,
    note: string | null,
    at: Date,
  ): void {
    const from = this.state.status;
    this.assertOpen(`move to ${to}`);
    if (to !== 'CANCELLED' && FORWARD.indexOf(to) <= FORWARD.indexOf(from)) {
      throw new InvalidStateTransitionError(from, `move to ${to}`);
    }
    const reason = optionalText(note, WORK_ORDER_TEXT_LIMITS.note, 'A note');
    if (to === 'CANCELLED' && reason === null) {
      throw new InvalidValueError('A cancelled work order needs a note');
    }
    this.state = {
      ...this.state,
      status: to,
      closedAt: CLOSED.includes(to) ? at : null,
    };
    this.changes.push({ from, to, actorId, note: reason, at });
  }

  private assertOpen(action: string): void {
    if (CLOSED.includes(this.state.status)) {
      throw new InvalidStateTransitionError(this.state.status, action);
    }
  }
}

/** The details with their texts trimmed, empty optional ones as `null`, and every rule checked. */
function validDetails(details: WorkOrderDetails): WorkOrderDetails {
  const limits = WORK_ORDER_TEXT_LIMITS;
  return {
    customerId: details.customerId,
    customerName: requiredText(
      details.customerName,
      limits.customerName,
      'A customer name',
    ),
    customerPhone: validPhone(details.customerPhone),
    customerEmail:
      optionalText(
        details.customerEmail,
        limits.customerEmail,
        'An email',
      )?.toLowerCase() ?? null,
    equipmentType: requiredText(
      details.equipmentType,
      limits.equipmentType,
      'An equipment type',
    ),
    equipmentBrand: optionalText(
      details.equipmentBrand,
      limits.equipmentBrand,
      'A brand',
    ),
    equipmentModel: optionalText(
      details.equipmentModel,
      limits.equipmentModel,
      'A model',
    ),
    serialNumber: optionalText(
      details.serialNumber,
      limits.serialNumber,
      'A serial number',
    ),
    accessories: optionalText(
      details.accessories,
      limits.accessories,
      'A list of accessories',
    ),
    equipmentCondition: optionalText(
      details.equipmentCondition,
      limits.equipmentCondition,
      'The condition',
    ),
    reportedFault: requiredText(
      details.reportedFault,
      limits.reportedFault,
      'A reported fault',
    ),
    diagnosis: optionalText(details.diagnosis, limits.diagnosis, 'A diagnosis'),
    workPerformed: optionalText(
      details.workPerformed,
      limits.workPerformed,
      'The work performed',
    ),
    estimatedCost: details.estimatedCost,
    technicianId: details.technicianId,
  };
}

function requiredText(text: string, max: number, what: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new InvalidValueError(`${what} has 1 to ${max} characters`);
  }
  return trimmed;
}

/** `null` for `null` or a blank text. */
function optionalText(
  text: string | null,
  max: number,
  what: string,
): string | null {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length > max) {
    throw new InvalidValueError(`${what} has at most ${max} characters`);
  }
  return trimmed === '' ? null : trimmed;
}

function validPhone(phone: string): string {
  if (!/^[0-9]{10}$/.test(phone)) {
    throw new InvalidValueError('A phone has exactly 10 digits');
  }
  return phone;
}
