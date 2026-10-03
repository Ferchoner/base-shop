import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { User, UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { findUserOfType } from './user-support.js';

/**
 * What anonymizing a customer deletes besides the data of the account (ADR-0067): their refresh tokens, their email
 * verification and password recovery links, which keep the address they were sent to, and their saved addresses. An
 * abstract class rather than an interface, so it can be the dependency injection token without depending on NestJS.
 */
export abstract class CustomerTraces {
  /** Deletes them all, in the transaction of the caller. */
  abstract deleteOf(customerId: UserId): Promise<void>;
}

/**
 * Anonymizes the account of a customer (UC-IAM-19, ADR-0067), in the transaction of the caller, which anonymizes
 * their orders and deletes their carts too (ADR-0145). Deleting the refresh tokens ends their sessions, because an
 * access token is honored only while its session has a usable one (ADR-0114). Audited as `customers.anonymize`,
 * without the values (BR-PRIV-04).
 */
@Injectable()
export class AnonymizeCustomer {
  constructor(
    private readonly users: UserRepository,
    private readonly traces: CustomerTraces,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * @throws NotFoundError for an ID that is not a customer's; VersionConflictError; InvalidStateTransitionError when
   *   the customer was already anonymized.
   */
  execute(input: {
    actorId: UserId;
    userId: UserId;
    reason: string;
    version: number;
    at: Date;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const user = await findUserOfType(this.users, input.userId, 'CUSTOMER');
      assertVersion(user.version, input.version);
      const before = auditedFields(user);
      user.anonymize(input.at);
      await this.users.save(user, input.actorId);
      await this.traces.deleteOf(user.id);
      await this.audit.record({
        action: 'customers.anonymize',
        resource: { type: 'user', id: user.id },
        changes: changesBetween(before, auditedFields(user)),
        reason: input.reason,
      });
    });
  }
}

/**
 * Anonymizes the account of a customer without activity since a date (ADR-0149, ADR-0152), in the transaction of the
 * caller: Privacy deletes their carts in the same one, and their orders follow their own retention cycle. The account
 * is locked and looked at again, so a customer active meanwhile is skipped. Audited as `customers.anonymize`, by the
 * system, without the values (BR-PRIV-04).
 */
@Injectable()
export class AnonymizeInactiveCustomer {
  constructor(
    private readonly users: UserRepository,
    private readonly traces: CustomerTraces,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /** @returns whether it anonymized the account: false when it is not a customer's, or not inactive any more. */
  execute(input: {
    userId: UserId;
    inactiveSince: Date;
    reason: string;
    at: Date;
  }): Promise<boolean> {
    return this.transactions.run(async () => {
      const user = await this.users.lockInactiveCustomer(
        input.userId,
        input.inactiveSince,
      );
      if (user === null) return false;
      const before = auditedFields(user);
      user.anonymize(input.at);
      await this.users.save(user, null);
      await this.traces.deleteOf(user.id);
      await this.audit.record({
        action: 'customers.anonymize',
        actor: { type: 'SYSTEM' },
        resource: { type: 'user', id: user.id },
        changes: changesBetween(before, auditedFields(user)),
        reason: input.reason,
      });
      return true;
    });
  }
}

/** The status, and the personal fields, which the audit trail records only as changed (BR-PRIV-04). */
function auditedFields(user: User): Record<string, unknown> {
  const { status, email, firstNames, lastNames, passwordHash } =
    user.snapshot();
  return { status, email, firstNames, lastNames, passwordHash };
}
