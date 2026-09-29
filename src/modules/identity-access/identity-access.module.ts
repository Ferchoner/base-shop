import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { parseDuration } from '../../platform/config/duration.js';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { GeoModule } from '../geo/index.js';
import { AddAddress } from './application/add-address.use-case.js';
import {
  AddressLocations,
  MAX_ADDRESSES,
} from './application/address-locations.js';
import { ChangePassword } from './application/change-password.use-case.js';
import { CreateRole } from './application/create-role.use-case.js';
import { DeleteRole } from './application/delete-role.use-case.js';
import { IdentityAccessFacade } from './application/identity-access.facade.js';
import { IdentityQueries } from './application/identity.queries.js';
import { PasswordChangeNotice } from './application/password-change-notice.js';
import { PasswordHasher } from './application/password-hasher.js';
import {
  CommonPasswords,
  PasswordPolicy,
} from './application/password-policy.js';
import { ReactivateCustomer } from './application/reactivate-customer.use-case.js';
import { RefreshSession } from './application/refresh-session.use-case.js';
import { RemoveAddress } from './application/remove-address.use-case.js';
import { ReplaceStaffRoles } from './application/replace-staff-roles.use-case.js';
import { ResolveSignedInAccount } from './application/resolve-signed-in-account.js';
import {
  AccessTokens,
  REFRESH_TOKEN_TTL_SECONDS,
  SessionTokens,
} from './application/session-tokens.js';
import { SignIn } from './application/sign-in.use-case.js';
import { SignOut } from './application/sign-out.use-case.js';
import { SuperadminContinuity } from './application/superadmin-continuity.js';
import { SuspendCustomer } from './application/suspend-customer.use-case.js';
import { SuspendStaff } from './application/suspend-staff.use-case.js';
import { UpdateAddress } from './application/update-address.use-case.js';
import { UpdateRole } from './application/update-role.use-case.js';
import { AddressBookRepository } from './domain/address-book.repository.js';
import { RoleRepository } from './domain/role.repository.js';
import { SessionRepository } from './domain/session.repository.js';
import { UserRepository } from './domain/user.repository.js';
import { AccessTokenKey } from './infrastructure/access-token-key.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.js';
import { FileCommonPasswords } from './infrastructure/file-common-passwords.js';
import { GeoAddressLocations } from './infrastructure/geo-address-locations.js';
import { JwtAccessTokens } from './infrastructure/jwt-access-tokens.js';
import { JwtStrategy } from './infrastructure/jwt.strategy.js';
import { PrismaAddressBookRepository } from './infrastructure/prisma-address-book.repository.js';
import { PrismaIdentityQueries } from './infrastructure/prisma-identity.queries.js';
import { PrismaRoleRepository } from './infrastructure/prisma-role.repository.js';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { AccessTokenGuard } from './presentation/access-token.guard.js';
import { AdminCustomersController } from './presentation/admin-customers.controller.js';
import {
  AdminPermissionsController,
  AdminRolesController,
} from './presentation/admin-roles.controller.js';
import { AdminStaffController } from './presentation/admin-staff.controller.js';
import { AuthController } from './presentation/auth.controller.js';
import { MeAddressesController } from './presentation/me-addresses.controller.js';
import { MeController } from './presentation/me.controller.js';

/**
 * Identity & Access bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. It also registers
 * the global guard that authenticates every request (ADR-0114), so AppModule imports it before rate limiting
 * and authorization: global guards run in the order their modules are imported.
 */
@Module({
  // The geographic catalog, for addresses (ADR-0113), and Passport, for the access token (ADR-0022).
  imports: [GeoModule, PassportModule.register({})],
  controllers: [
    AuthController,
    MeController,
    AdminPermissionsController,
    AdminRolesController,
    AdminStaffController,
    AdminCustomersController,
    MeAddressesController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    IdentityAccessFacade,
    SignIn,
    RefreshSession,
    SignOut,
    ChangePassword,
    PasswordPolicy,
    PasswordChangeNotice,
    ResolveSignedInAccount,
    SessionTokens,
    JwtStrategy,
    {
      provide: AccessTokenKey,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        AccessTokenKey.fromConfig(config),
    },
    {
      provide: REFRESH_TOKEN_TTL_SECONDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        parseDuration(config.get('REFRESH_TOKEN_TTL', { infer: true })),
    },
    { provide: AccessTokens, useClass: JwtAccessTokens },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: CommonPasswords, useFactory: () => new FileCommonPasswords() },
    { provide: SessionRepository, useClass: PrismaSessionRepository },
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
