import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
  OrderId,
  UserId,
  WarehouseId,
  WorkOrderId,
  WorkOrderStatus,
} from '../domain/work-order.js';

/** An entry of the status history of a work order. */
export interface WorkOrderStatusEntryView {
  readonly fromStatus: WorkOrderStatus | null;
  readonly toStatus: WorkOrderStatus;
  readonly actorId: UserId;
  readonly note: string | null;
  readonly occurredAt: Date;
}

/** A work order as the staff sees it (UC-WRK-02), with its folio and its status history. */
export interface WorkOrderView {
  readonly id: WorkOrderId;
  /** Such as `OT-000123` (ADR-0166). */
  readonly folio: string;
  readonly status: WorkOrderStatus;
  readonly customerId: UserId | null;
  /** `null` while blocked, and once anonymized (ADR-0167). */
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly customerEmail: string | null;
  readonly equipmentType: string;
  readonly equipmentBrand: string | null;
  readonly equipmentModel: string | null;
  readonly serialNumber: string | null;
  readonly accessories: string | null;
  readonly equipmentCondition: string | null;
  readonly reportedFault: string | null;
  readonly diagnosis: string | null;
  readonly workPerformed: string | null;
  readonly estimatedCost: Money | null;
  readonly warehouseId: WarehouseId;
  readonly receivedBy: UserId;
  readonly technicianId: UserId | null;
  readonly receivedAt: Date;
  readonly closedAt: Date | null;
  /**
   * When the data of its customer was blocked (ADR-0167): it shows only what an anonymized one keeps, and is read with
   * `work-orders.read-blocked`.
   */
  readonly blockedAt: Date | null;
  readonly anonymizedAt: Date | null;
  readonly version: number;
  /** Oldest first. */
  readonly statusHistory: readonly WorkOrderStatusEntryView[];
  /** The counter sales linked to it, in the order they were linked (ADR-0167). */
  readonly sales: readonly WorkOrderSaleLinkView[];
}

/** A counter sale linked to a work order, as its own table keeps it. */
export interface WorkOrderSaleLinkView {
  readonly orderId: OrderId;
  readonly linkedBy: UserId;
  readonly linkedAt: Date;
}

/** A work order in a list: who left what, and where it is. */
export interface WorkOrderSummaryView {
  readonly id: WorkOrderId;
  readonly folio: string;
  readonly status: WorkOrderStatus;
  /** `null` while blocked, and once anonymized (ADR-0167). */
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly equipmentType: string;
  readonly equipmentBrand: string | null;
  readonly equipmentModel: string | null;
  readonly serialNumber: string | null;
  readonly warehouseId: WarehouseId;
  readonly technicianId: UserId | null;
  readonly receivedAt: Date;
  readonly closedAt: Date | null;
}

export interface WorkOrderFilter {
  /** The folio exactly, or part of the name or the phone of the customer, or of the serial number (UC-WRK-02). */
  readonly q?: string;
  /** Any of these. */
  readonly status?: readonly WorkOrderStatus[];
  readonly warehouseId?: WarehouseId;
  readonly technicianId?: UserId;
  readonly customerId?: UserId;
  /** Received at or after. */
  readonly receivedFrom?: Date;
  /** Received at or before. */
  readonly receivedTo?: Date;
}

export type WorkOrderSortField = 'receivedAt' | 'folio';

/**
 * Read models of Work Orders, straight from its tables. An abstract class rather than an interface, so it can be
 * the dependency injection token without depending on NestJS.
 */
export abstract class WorkOrderQueries {
  abstract findWorkOrder(id: WorkOrderId): Promise<WorkOrderView | null>;

  abstract listWorkOrders(
    filter: WorkOrderFilter,
    sort: readonly SortOrder<WorkOrderSortField>[],
    page: PageRequest,
  ): Promise<Page<WorkOrderSummaryView>>;
}
