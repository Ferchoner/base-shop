import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  isPermissionCode,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { Role, type RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';

const WITH_PERMISSIONS = {
  permissions: { select: { permissionCode: true } },
} as const;

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSuperadmin: boolean;
  version: number;
  permissions: { permissionCode: string }[];
}

/** `roles` and `role_permissions` (DATABASE.md §3.2, §3.4), always through the active transaction. */
@Injectable()
export class PrismaRoleRepository extends RoleRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findById(id: RoleId): Promise<Role | null> {
    const row = await this.txHost.tx.role.findUnique({
      where: { id },
      include: WITH_PERMISSIONS,
    });
    return row === null ? null : toRole(row);
  }

  async findByIds(ids: readonly RoleId[]): Promise<Role[]> {
    if (ids.length === 0) return [];
    const rows = await this.txHost.tx.role.findMany({
      where: { id: { in: [...ids] } },
      include: WITH_PERMISSIONS,
    });
    return rows.map(toRole);
  }

  async save(role: Role): Promise<void> {
    const tx = this.txHost.tx;
    const state = role.snapshot();
    const data = { name: state.name, description: state.description };
    const { count } = await tx.role.updateMany({
      where: { id: state.id, version: state.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) {
      const current = await tx.role.findUnique({
        where: { id: state.id },
        select: { version: true },
      });
      if (current !== null) throw new VersionConflictError(current.version);
      await tx.role.create({
        data: { id: state.id, ...data, isSuperadmin: state.isSuperadmin },
      });
    }
    await tx.rolePermission.deleteMany({
      where: {
        roleId: state.id,
        permissionCode: { notIn: [...state.permissions] },
      },
    });
    if (state.permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: state.permissions.map((permissionCode) => ({
          roleId: state.id,
          permissionCode,
        })),
        skipDuplicates: true,
      });
    }
    if (count > 0) role.markSaved(state.version + 1);
  }
}

function toRole(row: RoleRow): Role {
  return Role.restore({
    id: toId<'Role'>(row.id),
    name: row.name,
    description: row.description,
    isSuperadmin: row.isSuperadmin,
    // A code removed from the catalog in code stops counting, even if a row still holds it.
    permissions: row.permissions
      .map(({ permissionCode }) => permissionCode)
      .filter(isPermissionCode),
    version: row.version,
  });
}
