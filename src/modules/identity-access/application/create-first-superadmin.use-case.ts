import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared-kernel/index.js';
import { RoleRepository } from '../domain/role.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { CreateStaff } from './create-staff.use-case.js';

/** An active superadmin exists: further staff is created through the API (ADR-0116). */
export class SuperadminAlreadyExistsError extends Error {
  constructor() {
    super('An active superadmin already exists');
  }
}

/**
 * Creates the first superadmin (UC-IAM-20, ADR-0043), for the operator's script: there is no default user in
 * the repository or the migrations. It refuses while any ACTIVE staff member holds the superadmin role, so
 * the script cannot add superadmins behind the API's back. The superadmin role stays locked meanwhile, so
 * two runs at the same time create one at most.
 */
@Injectable()
export class CreateFirstSuperadmin {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly createStaff: CreateStaff,
    private readonly transactions: TransactionManager,
  ) {}

  execute(input: {
    email: string;
    firstNames: string;
    lastNames: string;
  }): Promise<{ userId: UserId; temporaryPassword: string }> {
    return this.transactions.run(async () => {
      const superadmin = await this.roles.lockSuperadminRole();
      if ((await this.users.countActiveStaffWithRole(superadmin)) > 0) {
        throw new SuperadminAlreadyExistsError();
      }
      // Joins this transaction, so the check and the creation commit together.
      return this.createStaff.execute({
        actorId: null,
        ...input,
        roleIds: [superadmin],
      });
    });
  }
}
