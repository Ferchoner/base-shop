import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { GrantLimits } from './grant-limits.js';
import { TemporaryPasswords } from './temporary-passwords.js';
import { findUserOfType } from './user-support.js';

/**
 * Reactivates a suspended staff member, with a reason (UC-IAM-16, BR-USR-14, ADR-0076): a new temporary
 * password, returned once, that they must change on their next sign-in, because the suspension may have
 * been over a leaked password. Their roles stay. Audited as a security event. Whoever reactivates gets that password,
 * so it counts as giving them the roles of the staff member (BR-USR-20).
 */
@Injectable()
export class ReactivateStaff {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly grants: GrantLimits,
    private readonly temporaryPasswords: TemporaryPasswords,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    actorId: UserId;
    userId: UserId;
    reason: string;
    version: number;
  }): Promise<{ temporaryPassword: string }> {
    const temporary = await this.temporaryPasswords.issue();
    return this.transactions.run(async () => {
      const user = await findUserOfType(this.users, input.userId, 'STAFF');
      assertVersion(user.version, input.version);
      await this.grants.assertCanGrantRoles(
        input.actorId,
        await this.roles.findByIds(user.roleIds),
      );
      const before = { status: user.status, passwordHash: user.passwordHash };
      user.reactivateStaff(temporary.hash, this.clock.now());
      await this.users.save(user, input.actorId);
      await this.audit.record({
        action: 'staff.reactivate',
        resource: { type: 'user', id: user.id },
        changes: changesBetween(before, {
          status: user.status,
          passwordHash: user.passwordHash,
        }),
        reason: input.reason,
      });
      return { temporaryPassword: temporary.password };
    });
  }
}
