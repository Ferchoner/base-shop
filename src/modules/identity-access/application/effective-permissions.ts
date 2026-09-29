import {
  PERMISSION_CODES,
  type PermissionCode,
} from '../../../shared-kernel/index.js';
import type { RoleRepository } from '../domain/role.repository.js';
import type { User } from '../domain/user.js';

/**
 * The permissions of an ACTIVE staff member: the union of the permissions of their roles, every permission
 * with the superadmin role (ADR-0111), in catalog order. Customers and inactive accounts have none.
 */
export async function effectivePermissions(
  user: User,
  roles: RoleRepository,
): Promise<PermissionCode[]> {
  if (user.type !== 'STAFF' || user.status !== 'ACTIVE') return [];
  const granted = new Set(
    (await roles.findByIds(user.roleIds)).flatMap((role) =>
      role.effectivePermissions(),
    ),
  );
  return PERMISSION_CODES.filter((code) => granted.has(code));
}
