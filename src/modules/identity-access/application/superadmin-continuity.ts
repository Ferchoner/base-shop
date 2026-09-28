import { Injectable } from '@nestjs/common';
import { LastSuperadminError } from '../domain/identity-errors.js';
import type { RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { User } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';

/**
 * The system always keeps an ACTIVE staff member with the superadmin role (BR-USR-03, ADR-0112). Call it
 * inside the transaction, before a change that could take that role away from `user` or deactivate them.
 * It locks the superadmin role until the transaction ends, so two such changes check one after the other.
 */
@Injectable()
export class SuperadminContinuity {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  /**
   * Rejects with `LastSuperadminError` when `user` is an active superadmin, will stop being one
   * (`keepsSuperadmin` is false for the superadmin role) and nobody else is.
   */
  async ensureAnotherRemains(
    user: User,
    keepsSuperadmin: (superadminRoleId: RoleId) => boolean,
  ): Promise<void> {
    const superadminRoleId = await this.roles.lockSuperadminRole();
    const isActiveSuperadmin =
      user.status === 'ACTIVE' && user.roleIds.includes(superadminRoleId);
    if (!isActiveSuperadmin || keepsSuperadmin(superadminRoleId)) return;
    const others = await this.users.countActiveStaffWithRole(
      superadminRoleId,
      user.id,
    );
    if (others === 0) throw new LastSuperadminError();
  }
}
