import { Module } from '@nestjs/common';
import { CreateRole } from './application/create-role.use-case.js';
import { DeleteRole } from './application/delete-role.use-case.js';
import { IdentityAccessFacade } from './application/identity-access.facade.js';
import { IdentityQueries } from './application/identity.queries.js';
import { ReactivateCustomer } from './application/reactivate-customer.use-case.js';
import { ReplaceStaffRoles } from './application/replace-staff-roles.use-case.js';
import { SuperadminContinuity } from './application/superadmin-continuity.js';
import { SuspendCustomer } from './application/suspend-customer.use-case.js';
import { SuspendStaff } from './application/suspend-staff.use-case.js';
import { UpdateRole } from './application/update-role.use-case.js';
import { RoleRepository } from './domain/role.repository.js';
import { UserRepository } from './domain/user.repository.js';
import { PrismaIdentityQueries } from './infrastructure/prisma-identity.queries.js';
import { PrismaRoleRepository } from './infrastructure/prisma-role.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { AdminCustomersController } from './presentation/admin-customers.controller.js';
import {
  AdminPermissionsController,
  AdminRolesController,
} from './presentation/admin-roles.controller.js';
import { AdminStaffController } from './presentation/admin-staff.controller.js';

/** Identity & Access bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  controllers: [
    AdminPermissionsController,
    AdminRolesController,
    AdminStaffController,
    AdminCustomersController,
  ],
  providers: [
    IdentityAccessFacade,
    SuperadminContinuity,
    CreateRole,
    UpdateRole,
    DeleteRole,
    ReplaceStaffRoles,
    SuspendStaff,
    SuspendCustomer,
    ReactivateCustomer,
    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: RoleRepository, useClass: PrismaRoleRepository },
    { provide: IdentityQueries, useClass: PrismaIdentityQueries },
  ],
  exports: [IdentityAccessFacade],
})
export class IdentityAccessModule {}
