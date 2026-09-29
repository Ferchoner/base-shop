import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { SessionRepository } from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { findUserOfType } from './user-support.js';

/**
 * Suspends a customer, with a reason (UC-IAM-18, BR-USR-02): they can no longer sign in or renew their
 * session. Their sessions are revoked in the same transaction (ADR-0023, ADR-0114).
 */
@Injectable()
export class SuspendCustomer {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
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
      const now = this.clock.now();
      user.suspend(now);
      await this.users.save(user, input.actorId);
      await this.sessions.revokeAllOf(user.id, now);
      await this.audit.record({
        action: 'customers.suspend',
        resource: { type: 'user', id: user.id },
        changes: changesBetween({ status: before }, { status: user.status }),
        reason: input.reason,
      });
    });
  }
}
