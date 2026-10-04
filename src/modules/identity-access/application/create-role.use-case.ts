import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { Role, type RoleId } from '../domain/role.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { GrantLimits } from './grant-limits.js';
import { auditedFields } from './role-support.js';

/** Creates a role with permissions of the catalog that the actor holds (UC-IAM-15, BR-USR-04, BR-USR-20). */
@Injectable()
export class CreateRole {
  constructor(
    private readonly roles: RoleRepository,
    private readonly grants: GrantLimits,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(input: {
    actorId: UserId;
    name: string;
    description: string | null;
    permissions: readonly string[];
  }): Promise<RoleId> {
    return this.transactions.run(async () => {
      const role = Role.create({
        id: newId(),
        name: input.name,
        description: input.description,
        permissions: input.permissions,
      });
      await this.grants.assertCanGrantPermissions(
        input.actorId,
        role.effectivePermissions(),
      );
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
