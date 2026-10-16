import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  InvalidStateTransitionError,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  PERSONAL_WORK_ORDER_DATA,
  type UserId,
  type WorkOrder,
  type WorkOrderId,
} from '../domain/work-order.js';
import { OpenWorkOrdersError } from '../domain/work-order-errors.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';
import { personalDataOf } from './work-order-retention.js';
import { ReceptionResponses } from './work-order-ports.js';

/** The personal data that blocked work orders hide, read with a reason (ADR-0167). */
export type BlockedWorkOrderDataView = Readonly<
  Record<(typeof PERSONAL_WORK_ORDER_DATA)[number], string | null>
>;

/**
 * The anonymizations of work orders that a person asks for outside the system (BR-PRIV-02, ADR-0067, ADR-0167), and
 * the reading of the data of a blocked one. Each anonymization is audited as `work-orders.anonymize` with the
 * reference of the request as the reason and without the values (BR-PRIV-04), and forgets the response kept for
 * receiving the equipment, which holds them for 24 hours.
 */
@Injectable()
export class WorkOrderAnonymizations {
  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly responses: ReceptionResponses,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /**
   * Anonymizes one work order, delivered or cancelled, for a customer without an account (ADR-0167).
   *
   * @throws NotFoundError; InvalidStateTransitionError when it is open, or was anonymized already.
   */
  async one(input: { id: WorkOrderId; reason: string }): Promise<void> {
    await this.transactions.run(async () => {
      const workOrder = await this.workOrders.lock(input.id);
      if (workOrder === null) throw new NotFoundError('WorkOrder', input.id);
      await this.anonymize(workOrder, input.reason, this.clock.now());
    });
    // Last, because it runs outside the transaction: if the anonymization fails after all, only the replay of a
    // request repeated within 24 hours is lost.
    await this.responses.forgetOf([input.id]);
  }

  /**
   * Anonymizes every work order linked to a customer whose account is anonymized (UC-IAM-19, ADR-0145, ADR-0167), all
   * or none, in the transaction of the caller.
   *
   * @returns how many work orders it anonymized.
   * @throws OpenWorkOrdersError when one was neither delivered nor cancelled.
   */
  ofCustomer(input: {
    customerId: UserId;
    reason: string;
    at: Date;
  }): Promise<number> {
    return this.transactions.run(async () => {
      const workOrders = await this.workOrders.lockOfCustomer(input.customerId);
      // Every one first, so an open one stops it before anything is written.
      if (workOrders.some(({ snapshot }) => snapshot.closedAt === null)) {
        throw new OpenWorkOrdersError();
      }
      for (const workOrder of workOrders) {
        await this.anonymize(workOrder, input.reason, input.at);
      }
      // Last, because it runs outside the transaction, as above.
      await this.responses.forgetOf(workOrders.map(({ id }) => id));
      return workOrders.length;
    });
  }

  /**
   * The data of the customer of a blocked work order (ADR-0167), to answer a claim or a requirement, as saved. Audited
   * as `work-orders.read-blocked-data` with the reason and without the data; if the audit fails, nothing is returned.
   *
   * @throws NotFoundError; InvalidStateTransitionError when it is not blocked, so its data shows already, or was
   *   anonymized, so it has none.
   */
  readBlocked(input: {
    id: WorkOrderId;
    reason: string;
  }): Promise<BlockedWorkOrderDataView> {
    return this.transactions.run(async () => {
      const workOrder = await this.workOrders.lock(input.id);
      if (workOrder === null) throw new NotFoundError('WorkOrder', input.id);
      if (!workOrder.isBlocked || workOrder.isAnonymized) {
        throw new InvalidStateTransitionError(
          workOrder.status,
          'read blocked data',
        );
      }
      await this.audit.record({
        action: 'work-orders.read-blocked-data',
        resource: { type: 'work-order', id: input.id },
        reason: input.reason,
      });
      return personalDataOf(workOrder) as BlockedWorkOrderDataView;
    });
  }

  private async anonymize(
    workOrder: WorkOrder,
    reason: string,
    at: Date,
  ): Promise<void> {
    const before = personalDataOf(workOrder);
    workOrder.anonymize(at);
    await this.workOrders.save(workOrder, at);
    await this.audit.record({
      action: 'work-orders.anonymize',
      resource: { type: 'work-order', id: workOrder.id },
      changes: changesBetween(before, personalDataOf(workOrder), {
        personal: [...PERSONAL_WORK_ORDER_DATA],
      }),
      reason,
    });
  }
}
