import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../../shared-kernel/index.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { effectivePermissions } from './effective-permissions.js';

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
   * with the superadmin role (ADR-0111). Customers, suspended accounts and unknown ids have none.
   * Authentication reads them on every request (ADR-0114).
   */
  async permissionsOf(userId: UserId): Promise<PermissionCode[]> {
    const user = await this.users.findById(userId);
    return user === null ? [] : effectivePermissions(user, this.roles);
  }
}
