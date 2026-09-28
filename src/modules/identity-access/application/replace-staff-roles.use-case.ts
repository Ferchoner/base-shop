import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { UnknownRolesError } from '../domain/identity-errors.js';
import type { RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { SuperadminContinuity } from './superadmin-continuity.js';
import { findUserOfType } from './user-support.js';

/**
 * Replaces the roles of a staff member, at least one (UC-IAM-14, BR-USR-08). It never takes the superadmin
 * role away from the last active superadmin (BR-USR-03).
 */
@Injectable()
export class ReplaceStaffRoles {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly superadmins: SuperadminContinuity,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    actorId: UserId;
    userId: UserId;
    roleIds: readonly RoleId[];
    version: number;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const user = await findUserOfType(this.users, input.userId, 'STAFF');
      assertVersion(user.version, input.version);
      const roleIds = [...new Set(input.roleIds)];
      if ((await this.roles.findByIds(roleIds)).length !== roleIds.length) {
        throw new UnknownRolesError();
      }
      await this.superadmins.ensureAnotherRemains(user, (superadmin) =>
        roleIds.includes(superadmin),
      );
      const before = [...user.roleIds].sort();
      user.replaceRoles(roleIds);
      await this.users.save(user, input.actorId);
      await this.audit.record({
        action: 'staff.roles-replace',
        resource: { type: 'user', id: user.id },
        changes: changesBetween(
          { roleIds: before },
          { roleIds: [...user.roleIds].sort() },
        ),
      });
    });
  }
}
