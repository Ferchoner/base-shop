import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { UnknownRolesError } from '../domain/identity-errors.js';
import type { RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import { User, type UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { GrantLimits } from './grant-limits.js';
import { TemporaryPasswords } from './temporary-passwords.js';

/**
 * Creates a staff account with a temporary password (UC-IAM-13, BR-USR-09, BR-USR-13). The password is
 * returned once, to be shown to whoever creates the account; there is no invitation email (ADR-0043). The
 * email must be free across customers and staff (BR-USR-01), and whoever creates it must hold its roles (BR-USR-20).
 */
@Injectable()
export class CreateStaff {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly grants: GrantLimits,
    private readonly temporaryPasswords: TemporaryPasswords,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  /** `actorId` is `null` when the system creates the account (the first superadmin, UC-IAM-20). */
  async execute(input: {
    actorId: UserId | null;
    email: string;
    firstNames: string;
    lastNames: string;
    roleIds: readonly RoleId[];
  }): Promise<{ userId: UserId; temporaryPassword: string }> {
    const temporary = await this.temporaryPasswords.issue();
    return this.transactions.run(async () => {
      const roleIds = [...new Set(input.roleIds)];
      const roles = await this.roles.findByIds(roleIds);
      if (roles.length !== roleIds.length) throw new UnknownRolesError();
      if (input.actorId !== null) {
        await this.grants.assertCanGrantRoles(input.actorId, roles);
      }
      const user = User.createStaff({
        id: newId(),
        email: input.email,
        firstNames: input.firstNames,
        lastNames: input.lastNames,
        roleIds,
        temporaryPasswordHash: temporary.hash,
        now: this.clock.now(),
      });
      await this.users.add(user, input.actorId);
      const { email, firstNames, lastNames } = user.snapshot();
      await this.audit.record({
        action: 'staff.create',
        resource: { type: 'user', id: user.id },
        // Email and names are personal: the audit only records that they were set (ADR-0067).
        changes: changesBetween(
          { email: null, firstNames: null, lastNames: null, roleIds: [] },
          { email, firstNames, lastNames, roleIds: [...user.roleIds].sort() },
        ),
      });
      return { userId: user.id, temporaryPassword: temporary.password };
    });
  }
}
