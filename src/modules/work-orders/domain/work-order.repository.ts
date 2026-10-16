import type { WorkOrder, WorkOrderId } from './work-order.js';

/**
 * Persistence of work orders (DATABASE.md §17). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class WorkOrderRepository {
  /**
   * Saves a new work order with the first entry of its status history, in the transaction of the caller; the
   * database gives it the next number of its folio (ADR-0166).
   */
  abstract insert(workOrder: WorkOrder, now: Date): Promise<void>;

  /** The work order with this ID; `null` if it does not exist. */
  abstract find(id: WorkOrderId): Promise<WorkOrder | null>;

  /**
   * Writes the data and the status of a work order and one history entry per status change, and counts one more
   * version. Every change carries the version read, so two changes never cross without one failing.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(workOrder: WorkOrder, now: Date): Promise<void>;
}
