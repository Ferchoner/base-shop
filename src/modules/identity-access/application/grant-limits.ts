import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '../../../shared-kernel/index.js';
import { PermissionNotHeldError } from '../domain/identity-errors.js';
import type { Role } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';

/** What a staff member holds: the permissions of their roles, and whether one of them is the superadmin role. */
interface Holdings {
  readonly superadmin: boolean;
  readonly permissions: ReadonlySet<PermissionCode>;
}

/**
 * Nobody gives what they do not hold (BR-USR-20, ADR-0154): a staff member only grants roles and permissions they
 * hold themselves, and only a superadmin grants the superadmin role. Without it, `staff.manage` would be every
 * permission, since roles are editable (T-310). Taking away is never limited: a role removed or a staff member
 * suspended gives nobody anything.
 */
@Injectable()
export class GrantLimits {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
  ) {}

  /**
   * Roles given to a staff member, or whose temporary password the actor gets on a reactivation.
   *
   * @throws PermissionNotHeldError when a role is the superadmin role and the actor is not a superadmin, or has a
   *   permission the actor lacks.
   */
  async assertCanGrantRoles(
    actorId: UserId,
    roles: readonly Role[],
  ): Promise<void> {
    if (roles.length === 0) return;
    const actor = await this.holdingsOf(actorId);
    const grantable = roles.every((role) =>
      role.isSuperadmin
        ? actor.superadmin
        : holdsAll(actor, role.effectivePermissions()),
    );
    if (!grantable) throw new PermissionNotHeldError();
  }

  /**
   * Permissions added to a role.
   *
   * @throws PermissionNotHeldError when the actor lacks one of them.
   */
  async assertCanGrantPermissions(
    actorId: UserId,
    permissions: readonly PermissionCode[],
  ): Promise<void> {
    if (permissions.length === 0) return;
    if (!holdsAll(await this.holdingsOf(actorId), permissions)) {
      throw new PermissionNotHeldError();
    }
  }

  /** An actor that is not an ACTIVE staff member holds nothing. */
  private async holdingsOf(actorId: UserId): Promise<Holdings> {
    const actor = await this.users.findById(actorId);
    if (actor === null || actor.type !== 'STAFF' || actor.status !== 'ACTIVE') {
      return { superadmin: false, permissions: new Set() };
    }
    const roles = await this.roles.findByIds(actor.roleIds);
    return {
      superadmin: roles.some((role) => role.isSuperadmin),
      permissions: new Set(
        roles.flatMap((role) => role.effectivePermissions()),
      ),
    };
  }
}

function holdsAll(
  holdings: Holdings,
  permissions: readonly PermissionCode[],
): boolean {
  return permissions.every((code) => holdings.permissions.has(code));
}
