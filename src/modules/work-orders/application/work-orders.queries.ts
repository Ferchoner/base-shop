import type {
  Money,
  Page,
  PageRequest,
  SortOrder,
} from '../../../shared-kernel/index.js';
import type {
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
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  readonly equipmentType: string;
  readonly equipmentBrand: string | null;
  readonly equipmentModel: string | null;
  readonly serialNumber: string | null;
  readonly accessories: string | null;
  readonly equipmentCondition: string | null;
  readonly reportedFault: string;
  readonly diagnosis: string | null;
  readonly workPerformed: string | null;
  readonly estimatedCost: Money | null;
  readonly warehouseId: WarehouseId;
  readonly receivedBy: UserId;
  readonly technicianId: UserId | null;
  readonly receivedAt: Date;
  readonly closedAt: Date | null;
  readonly version: number;
  /** Oldest first. */
  readonly statusHistory: readonly WorkOrderStatusEntryView[];
}

/** A work order in a list: who left what, and where it is. */
export interface WorkOrderSummaryView {
  readonly id: WorkOrderId;
  readonly folio: string;
  readonly status: WorkOrderStatus;
  readonly customerName: string;
  readonly customerPhone: string;
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
