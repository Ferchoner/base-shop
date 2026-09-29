import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  InvalidStateTransitionError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { SessionRepository } from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { SuperadminContinuity } from './superadmin-continuity.js';
import { findUserOfType } from './user-support.js';

/**
 * Suspends a staff member, with a reason (UC-IAM-16, BR-USR-06): the account stays, but can no longer sign
 * in. Nobody suspends themselves, and the last active superadmin is never suspended (BR-USR-03). Their
 * sessions are revoked in the same transaction (ADR-0023, ADR-0114).
 */
@Injectable()
export class SuspendStaff {
  constructor(
    private readonly users: UserRepository,
    private readonly superadmins: SuperadminContinuity,
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
      const user = await findUserOfType(this.users, input.userId, 'STAFF');
      assertVersion(user.version, input.version);
      if (user.id === input.actorId) {
        throw new InvalidStateTransitionError(user.status, 'suspend yourself');
      }
      await this.superadmins.ensureAnotherRemains(user, () => false);
      const before = user.status;
      const now = this.clock.now();
      user.suspend(now);
      await this.users.save(user, input.actorId);
      await this.sessions.revokeAllOf(user.id, now);
      await this.audit.record({
        action: 'staff.suspend',
        resource: { type: 'user', id: user.id },
        changes: changesBetween({ status: before }, { status: user.status }),
        reason: input.reason,
      });
    });
  }
}
