import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  monthsBefore,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  PERSONAL_WORK_ORDER_DATA,
  type WorkOrder,
  type WorkOrderId,
} from '../domain/work-order.js';
import { WorkOrderRepository } from '../domain/work-order.repository.js';

/**
 * The retention of the personal data of work orders (ADR-0167), with the variables of the orders (ADR-0149, ADR-0151):
 * `PERSONAL_DATA_RETENTION_ENABLED`, `PERSONAL_DATA_OPERATIONAL_MONTHS` and `PERSONAL_DATA_BLOCKED_MONTHS`.
 */
export interface WorkOrderRetentionPolicy {
  readonly enabled: boolean;
  /** Months after a work order was delivered or cancelled before the data of its customer is blocked. */
  readonly operationalMonths: number;
  /** Months it stays blocked before it is anonymized; with 0, it is anonymized when it would be blocked. */
  readonly blockedMonths: number;
}

/** Dependency injection token of the `WorkOrderRetentionPolicy`. */
export const WORK_ORDER_RETENTION = Symbol('WORK_ORDER_RETENTION');

/**
 * Work orders one run blocks at most, and anonymizes at most: the rest wait for the next day, so a period shortened
 * by mistake can be fixed before everything is anonymized, as with orders (ADR-0144, ADR-0151).
 */
export const RETENTION_BATCH_SIZE = 1_000;

/** The reason of an anonymization by the retention cycle, in the audit trail. */
export const RETENTION_REASON =
  'Plazo de conservación de datos personales vencido (ADR-0149)';

/** What one run did. */
export interface RetentionRun {
  readonly blocked: number;
  readonly anonymized: number;
  /** Work orders whose step failed; the log tells why, and the next run tries them again. */
  readonly failed: number;
}

/** The personal data of a work order, which the audit trail records only as changed (BR-PRIV-04). */
export function personalDataOf(workOrder: WorkOrder): Record<string, unknown> {
  const { snapshot } = workOrder;
  return Object.fromEntries(
    PERSONAL_WORK_ORDER_DATA.map((field) => [field, snapshot[field]]),
  );
}

/**
 * The retention cycle of the personal data of work orders (ADR-0167), run every day as the one of orders (ADR-0151):
 * - it blocks the data of the customer of the work orders delivered or cancelled `operationalMonths` ago: it stays,
 *   hidden from the usual responses;
 * - it anonymizes it `blockedMonths` later. The responses kept for receiving the equipment last 24 hours, far less
 *   than any operational phase, so none is left by then.
 *
 * Each work order goes in its own transaction, locked and looked at again, and is audited as the system, without the
 * values (BR-PRIV-04). One that fails goes to the log, and the others go on.
 */
@Injectable()
export class WorkOrderRetention {
  private readonly logger = new Logger(WorkOrderRetention.name);

  constructor(
    private readonly workOrders: WorkOrderRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    @Inject(WORK_ORDER_RETENTION)
    private readonly policy: WorkOrderRetentionPolicy,
  ) {}

  async run(): Promise<RetentionRun> {
    if (!this.policy.enabled) {
      this.logger.log('Personal data retention of work orders is disabled');
      return { blocked: 0, anonymized: 0, failed: 0 };
    }
    const now = this.clock.now();
    const blockBy = monthsBefore(now, this.policy.operationalMonths);
    const anonymizeBy = monthsBefore(
      now,
      this.policy.operationalMonths + this.policy.blockedMonths,
    );
    let failed = 0;
    let blocked = 0;
    for (const id of await this.workOrders.dueForBlocking(
      blockBy,
      RETENTION_BATCH_SIZE,
    )) {
      const outcome = await this.attempt('block', id, () =>
        this.block(id, blockBy, now),
      );
      if (outcome === null) failed += 1;
      else if (outcome) blocked += 1;
    }
    let anonymized = 0;
    for (const id of await this.workOrders.dueForAnonymization(
      anonymizeBy,
      RETENTION_BATCH_SIZE,
    )) {
      const outcome = await this.attempt('anonymize', id, () =>
        this.anonymize(id, anonymizeBy, now),
      );
      if (outcome === null) failed += 1;
      else if (outcome) anonymized += 1;
    }
    this.logger.log(
      `Personal data retention: ${blocked} work orders blocked, ${anonymized} anonymized, ${failed} failed`,
    );
    return { blocked, anonymized, failed };
  }

  /** Answers the outcome of `step`, or `null` when it failed, which goes to the log. */
  private async attempt(
    step: string,
    id: WorkOrderId,
    work: () => Promise<boolean>,
  ): Promise<boolean | null> {
    try {
      return await work();
    } catch (error) {
      this.logger.error(
        `Retention could not ${step} work order ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  private block(id: WorkOrderId, cutoff: Date, now: Date): Promise<boolean> {
    return this.transactions.run(async () => {
      const workOrder = await this.workOrders.lock(id);
      if (workOrder === null || !workOrder.blockIfDue(cutoff, now)) {
        return false;
      }
      await this.workOrders.save(workOrder, now);
      await this.audit.record({
        action: 'work-orders.block',
        actor: { type: 'SYSTEM' },
        resource: { type: 'work-order', id },
        changes: changesBetween({ blockedAt: null }, { blockedAt: now }),
      });
      return true;
    });
  }

  private anonymize(
    id: WorkOrderId,
    cutoff: Date,
    now: Date,
  ): Promise<boolean> {
    return this.transactions.run(async () => {
      const workOrder = await this.workOrders.lock(id);
      if (
        workOrder === null ||
        workOrder.isAnonymized ||
        !workOrder.closedBy(cutoff)
      ) {
        return false;
      }
      const before = personalDataOf(workOrder);
      workOrder.anonymize(now);
      await this.workOrders.save(workOrder, now);
      await this.audit.record({
        action: 'work-orders.anonymize',
        actor: { type: 'SYSTEM' },
        resource: { type: 'work-order', id },
        changes: changesBetween(before, personalDataOf(workOrder), {
          personal: [...PERSONAL_WORK_ORDER_DATA],
        }),
        reason: RETENTION_REASON,
      });
      return true;
    });
  }
}
