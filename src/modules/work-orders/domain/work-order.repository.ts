import type { UserId, WorkOrder, WorkOrderId } from './work-order.js';

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
   * The work order with this ID, its row locked until the transaction ends; `null` if it does not exist. For the
   * changes that carry no version, which block and anonymize the data of the customer (ADR-0167).
   */
  abstract lock(id: WorkOrderId): Promise<WorkOrder | null>;

  /**
   * The work orders linked to a customer that were not anonymized, locked like `lock`, in the order of their IDs, so
   * two anonymizations of the same customer wait for each other (ADR-0145, ADR-0167).
   */
  abstract lockOfCustomer(customerId: UserId): Promise<WorkOrder[]>;

  /**
   * Up to `limit` work orders closed at `cutoff` or before and neither blocked nor anonymized, the oldest closed first
   * (ADR-0167). They are not locked: whoever blocks one locks it and looks again.
   */
  abstract dueForBlocking(cutoff: Date, limit: number): Promise<WorkOrderId[]>;

  /**
   * Up to `limit` work orders closed at `cutoff` or before and not anonymized, blocked or not, the oldest closed
   * first. Not locked either.
   */
  abstract dueForAnonymization(
    cutoff: Date,
    limit: number,
  ): Promise<WorkOrderId[]>;

  /**
   * Writes the data and the status of a work order and one history entry per status change, and counts one more
   * version. Every change carries the version read, so two changes never cross without one failing.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(workOrder: WorkOrder, now: Date): Promise<void>;
}
