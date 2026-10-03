import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  monthsBefore,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { Order, OrderId } from '../domain/order.js';
import { OrderAccessTokenRepository } from '../domain/order-access-token.js';
import { OrderRepository } from '../domain/order.repository.js';
import { OrderShipments } from './shipment-ports.js';

/**
 * The retention of the personal data of orders and shipments (ADR-0070, ADR-0149, ADR-0151): `PERSONAL_DATA_RETENTION_ENABLED`,
 * `PERSONAL_DATA_OPERATIONAL_MONTHS` and `PERSONAL_DATA_BLOCKED_MONTHS`.
 */
export interface PersonalDataRetentionPolicy {
  readonly enabled: boolean;
  /** Months after an order concluded before the data of its buyer is blocked. */
  readonly operationalMonths: number;
  /** Months it stays blocked before it is anonymized; with 0, it is anonymized when it would be blocked. */
  readonly blockedMonths: number;
}

/** Dependency injection token of the `PersonalDataRetentionPolicy`. */
export const PERSONAL_DATA_RETENTION = Symbol('PERSONAL_DATA_RETENTION');

/**
 * Orders one run blocks at most, and anonymizes at most: the rest wait for the next day, so a period shortened by
 * mistake can be fixed before everything is anonymized (ADR-0144, ADR-0151).
 */
export const RETENTION_BATCH_SIZE = 1_000;

/** The reason of an anonymization by the retention cycle, in the audit trail. */
export const RETENTION_REASON =
  'Plazo de conservación de datos personales vencido (ADR-0149)';

/** What one run did. */
export interface RetentionRun {
  readonly blocked: number;
  readonly anonymized: number;
  /** Orders whose step failed; the log tells why, and the next run tries them again. */
  readonly failed: number;
}

/**
 * The retention cycle of the personal data of orders and shipments (UC-SYS-02, ADR-0070, ADR-0151), run every day:
 * - it blocks the data of the orders that concluded `operationalMonths` ago, with their shipments: it stays, hidden
 *   from the buyer and the staff;
 * - it anonymizes it `blockedMonths` later, as UC-IAM-19 does (ADR-0067, ADR-0145), with the access links of the
 *   email of a guest. The responses kept for placing an order last 24 hours, far less than any operational phase, so
 *   none is left by then.
 *
 * Each order goes in its own transaction, locked and looked at again, and is audited as the system, without the
 * values (BR-PRIV-04). An order that fails goes to the log, and the others go on.
 */
@Injectable()
export class PersonalDataRetention {
  private readonly logger = new Logger(PersonalDataRetention.name);

  constructor(
    private readonly orders: OrderRepository,
    private readonly shipments: OrderShipments,
    private readonly accessTokens: OrderAccessTokenRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    @Inject(PERSONAL_DATA_RETENTION)
    private readonly policy: PersonalDataRetentionPolicy,
  ) {}

  async run(): Promise<RetentionRun> {
    if (!this.policy.enabled) {
      this.logger.log('Personal data retention is disabled');
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
    for (const id of await this.orders.dueForBlocking(
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
    for (const id of await this.orders.dueForAnonymization(
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
      `Personal data retention: ${blocked} orders blocked, ${anonymized} anonymized, ${failed} failed`,
    );
    return { blocked, anonymized, failed };
  }

  /** Answers the outcome of `step`, or `null` when it failed, which goes to the log. */
  private async attempt(
    step: string,
    id: OrderId,
    work: () => Promise<boolean>,
  ): Promise<boolean | null> {
    try {
      return await work();
    } catch (error) {
      this.logger.error(
        `Retention could not ${step} order ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  private block(id: OrderId, cutoff: Date, now: Date): Promise<boolean> {
    return this.transactions.run(async () => {
      const order = await this.orders.lock(id);
      if (order === null || !order.blockIfDue(cutoff, now)) return false;
      await this.orders.save(order, now);
      await this.shipments.block([id], now);
      await this.audit.record({
        action: 'orders.block',
        actor: { type: 'SYSTEM' },
        resource: { type: 'order', id },
        changes: changesBetween({ blockedAt: null }, { blockedAt: now }),
      });
      return true;
    });
  }

  private anonymize(id: OrderId, cutoff: Date, now: Date): Promise<boolean> {
    return this.transactions.run(async () => {
      const order = await this.orders.lock(id);
      if (order === null || order.isAnonymized || !order.concludedBy(cutoff)) {
        return false;
      }
      const { customerId, contactEmail } = order.snapshot;
      const shipment = (await this.shipments.shipmentsOf([id])).get(id);
      const before = personalFields(order);
      order.anonymize(shipment?.status ?? null, now);
      await this.orders.save(order, now);
      await this.audit.record({
        action: 'orders.anonymize',
        actor: { type: 'SYSTEM' },
        resource: { type: 'order', id },
        changes: changesBetween(before, personalFields(order)),
        reason: RETENTION_REASON,
      });
      await this.shipments.anonymize([id], now);
      if (customerId === null && contactEmail !== null) {
        await this.accessTokens.deleteOf(contactEmail);
      }
      return true;
    });
  }
}

/** The personal fields of an order, which the audit trail records only as changed (BR-PRIV-04). */
function personalFields(order: Order): Record<string, unknown> {
  const { contactEmail, shippingAddress } = order.snapshot;
  return { contactEmail, shippingAddress };
}
