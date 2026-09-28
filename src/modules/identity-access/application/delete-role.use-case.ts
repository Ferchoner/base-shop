import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  ResourceInUseError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { LastSuperadminError } from '../domain/identity-errors.js';
import type { RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import { auditedFields, findRole } from './role-support.js';

/**
 * Deletes a role without users (UC-IAM-15, BR-USR-07). The superadmin role is never deleted (BR-USR-03).
 */
@Injectable()
export class DeleteRole {
  constructor(
    private readonly roles: RoleRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(id: RoleId): Promise<void> {
    return this.transactions.run(async () => {
      const role = await findRole(this.roles, id);
      if (role.isSuperadmin) throw new LastSuperadminError();
      if ((await this.roles.countUsers(id)) > 0) {
        throw new ResourceInUseError(`Role ${id} has users`);
      }
      await this.roles.delete(role);
      await this.audit.record({
        action: 'roles.delete',
        resource: { type: 'role', id },
        changes: changesBetween(auditedFields(role), {}),
      });
    });
  }
}
