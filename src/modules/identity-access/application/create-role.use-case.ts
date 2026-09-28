import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { Role, type RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import { auditedFields } from './role-support.js';

/** Creates a role with permissions of the catalog (UC-IAM-15, BR-USR-04). */
@Injectable()
export class CreateRole {
  constructor(
    private readonly roles: RoleRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    name: string;
    description: string | null;
    permissions: readonly string[];
  }): Promise<RoleId> {
    return this.transactions.run(async () => {
      const role = Role.create({ id: newId(), ...input });
      await this.roles.save(role);
      await this.audit.record({
        action: 'roles.create',
        resource: { type: 'role', id: role.id },
        changes: changesBetween({}, auditedFields(role)),
      });
      return role.id;
    });
  }
}
