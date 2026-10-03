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

/** The status, and the personal fields, which the audit trail records only as changed (BR-PRIV-04). */
function auditedFields(user: User): Record<string, unknown> {
  const { status, email, firstNames, lastNames, passwordHash } =
    user.snapshot();
  return { status, email, firstNames, lastNames, passwordHash };
}
