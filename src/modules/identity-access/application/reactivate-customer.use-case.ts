import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { findUserOfType } from './user-support.js';

/**
 * Reactivates a suspended customer, with a reason (UC-IAM-18, BR-USR-14, ADR-0076). They keep their password
 * and email verification. An anonymized customer is never reactivated. Audited as a security event.
 */
@Injectable()
export class ReactivateCustomer {
  constructor(
    private readonly users: UserRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    actorId: UserId;
    userId: UserId;
    reason: string;
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const user = await findUserOfType(this.users, input.userId, 'CUSTOMER');
      assertVersion(user.version, input.version);
      const before = user.status;
      user.reactivateCustomer();
      await this.users.save(user, input.actorId);
      await this.audit.record({
        action: 'customers.reactivate',
        resource: { type: 'user', id: user.id },
        changes: changesBetween({ status: before }, { status: user.status }),
        reason: input.reason,
      });
    });
  }
}
