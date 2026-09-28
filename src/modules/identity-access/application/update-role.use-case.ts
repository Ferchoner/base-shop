import { Injectable } from '@nestjs/common';
import {
  assertVersion,
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import { auditedFields, findRole } from './role-support.js';

/**
 * Renames a role, changes its description or replaces its permissions (UC-IAM-15). The superadmin role can
 * be renamed, but its permissions never change (ADR-0112).
 */
@Injectable()
export class UpdateRole {
  constructor(
    private readonly roles: RoleRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(
    id: RoleId,
    changes: {
      name?: string;
      description?: string | null;
      permissions?: readonly string[];
      version: number;
    },
  ): Promise<void> {
    return this.transactions.run(async () => {
      const role = await findRole(this.roles, id);
      assertVersion(role.version, changes.version);
      const before = auditedFields(role);
      if (changes.name !== undefined) role.rename(changes.name);
      if (changes.description !== undefined) role.describe(changes.description);
      if (changes.permissions !== undefined) {
        role.replacePermissions(changes.permissions);
      }
      await this.roles.save(role);
      await this.audit.record({
        action: 'roles.update',
        resource: { type: 'role', id },
        changes: changesBetween(before, auditedFields(role)),
      });
    });
  }
}
