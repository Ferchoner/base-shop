import { Module } from '@nestjs/common';
import { IdentityAccessFacade } from './application/identity-access.facade.js';
import { RoleRepository } from './domain/role.repository.js';
import { UserRepository } from './domain/user.repository.js';
import { PrismaRoleRepository } from './infrastructure/prisma-role.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';

/** Identity & Access bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  providers: [
    IdentityAccessFacade,
    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: RoleRepository, useClass: PrismaRoleRepository },
  ],
  exports: [IdentityAccessFacade],
})
export class IdentityAccessModule {}
