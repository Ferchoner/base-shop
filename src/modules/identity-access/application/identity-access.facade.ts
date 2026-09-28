import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../../shared-kernel/index.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';

/**
 * Public, read-only operations of Identity & Access for the rest of the application (ADR-0005).
 */
@Injectable()
export class IdentityAccessFacade {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  /**
   * The permissions of an ACTIVE staff member: the union of the permissions of their roles, every permission
   * with the superadmin role (ADR-0111). Customers, suspended accounts and unknown ids have none. Authentication
   * (T-120) puts them in `request.user`.
   */
  async permissionsOf(userId: UserId): Promise<PermissionCode[]> {
    const user = await this.users.findById(userId);
    if (user === null || user.type !== 'STAFF' || user.status !== 'ACTIVE') {
      return [];
    }
    const roles = await this.roles.findByIds(user.roleIds);
    return [...new Set(roles.flatMap((role) => role.effectivePermissions()))];
  }
}
