import { NotFoundError } from '../../../shared-kernel/index.js';
import type { Role, RoleId } from '../domain/role.js';
import type { RoleRepository } from '../domain/role.repository.js';

/** What the audit trail keeps of a role: its editable fields, permissions sorted so a reorder is no change. */
export function auditedFields(role: Role): Record<string, unknown> {
  const { name, description, permissions } = role.snapshot();
  return { name, description, permissions: [...permissions].sort() };
}

export async function findRole(
  roles: RoleRepository,
  id: RoleId,
): Promise<Role> {
  const role = await roles.findById(id);
  if (role === null) throw new NotFoundError('Role', id);
  return role;
}
