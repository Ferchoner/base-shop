import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { GeoModule } from '../geo/index.js';
import { AddAddress } from './application/add-address.use-case.js';
import {
  AddressLocations,
  MAX_ADDRESSES,
} from './application/address-locations.js';
import { CreateRole } from './application/create-role.use-case.js';
import { DeleteRole } from './application/delete-role.use-case.js';
import { IdentityAccessFacade } from './application/identity-access.facade.js';
import { IdentityQueries } from './application/identity.queries.js';
import { ReactivateCustomer } from './application/reactivate-customer.use-case.js';
import { RemoveAddress } from './application/remove-address.use-case.js';
import { ReplaceStaffRoles } from './application/replace-staff-roles.use-case.js';
import { SuperadminContinuity } from './application/superadmin-continuity.js';
import { SuspendCustomer } from './application/suspend-customer.use-case.js';
import { SuspendStaff } from './application/suspend-staff.use-case.js';
import { UpdateAddress } from './application/update-address.use-case.js';
import { UpdateRole } from './application/update-role.use-case.js';
import { AddressBookRepository } from './domain/address-book.repository.js';
import { RoleRepository } from './domain/role.repository.js';
import { UserRepository } from './domain/user.repository.js';
import { GeoAddressLocations } from './infrastructure/geo-address-locations.js';
import { PrismaAddressBookRepository } from './infrastructure/prisma-address-book.repository.js';
import { PrismaIdentityQueries } from './infrastructure/prisma-identity.queries.js';
import { PrismaRoleRepository } from './infrastructure/prisma-role.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { AdminCustomersController } from './presentation/admin-customers.controller.js';
import {
  AdminPermissionsController,
  AdminRolesController,
} from './presentation/admin-roles.controller.js';
import { AdminStaffController } from './presentation/admin-staff.controller.js';
import { MeAddressesController } from './presentation/me-addresses.controller.js';

/** Identity & Access bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  // The geographic catalog, for addresses (ADR-0113).
  imports: [GeoModule],
  controllers: [
    AdminPermissionsController,
    AdminRolesController,
    AdminStaffController,
    AdminCustomersController,
    MeAddressesController,
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
    AddAddress,
    UpdateAddress,
    RemoveAddress,
    {
      provide: MAX_ADDRESSES,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MAX_ADDRESSES_PER_CUSTOMER', { infer: true }),
    },
    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: RoleRepository, useClass: PrismaRoleRepository },
    { provide: IdentityQueries, useClass: PrismaIdentityQueries },
    { provide: AddressBookRepository, useClass: PrismaAddressBookRepository },
    { provide: AddressLocations, useClass: GeoAddressLocations },
  ],
  exports: [IdentityAccessFacade],
})
export class IdentityAccessModule {}
