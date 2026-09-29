import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Prisma } from '../../../platform/persistence/prisma/generated/client.js';
import { isUniqueViolation } from '../../../platform/persistence/prisma-errors.js';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import {
  DuplicateValueError,
  toId,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import type { RoleId } from '../domain/role.js';
import { User, type UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';

const ROLE_IDS = { roles: { select: { roleId: true } } } as const;

type UserRow = Prisma.UserGetPayload<{ include: typeof ROLE_IDS }>;

/** `users` and `user_roles` (DATABASE.md §3.1, §3.3), always through the active transaction. */
@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async findById(id: UserId): Promise<User | null> {
    const row = await this.txHost.tx.user.findUnique({
      where: { id },
      include: ROLE_IDS,
    });
    return row === null ? null : toUser(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.txHost.tx.user.findUnique({
      where: { email },
      include: ROLE_IDS,
    });
    return row === null ? null : toUser(row);
  }

  async recordSignIn(id: UserId, at: Date): Promise<void> {
    await this.txHost.tx.user.update({
      where: { id },
      data: { lastLoginAt: at },
    });
  }

  async add(user: User, createdBy: UserId | null): Promise<void> {
    const state = user.snapshot();
    try {
      await this.txHost.tx.user.create({
        data: {
          id: state.id,
          type: state.type,
          status: state.status,
          email: state.email,
          firstNames: state.firstNames,
          lastNames: state.lastNames,
          passwordHash: state.passwordHash,
          passwordChangedAt: state.passwordChangedAt,
          mustChangePassword: state.mustChangePassword,
          emailVerifiedAt: state.emailVerifiedAt,
          privacyNoticeVersion: state.privacyNoticeVersion,
          version: state.version,
          createdAt: state.createdAt,
          roles: {
            create: state.roleIds.map((roleId) => ({
              roleId,
              assignedBy: createdBy,
            })),
          },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateValueError('email');
      throw error;
    }
  }

  async save(user: User, changedBy: UserId | null): Promise<void> {
    const tx = this.txHost.tx;
    const state = user.snapshot();
    let count: number;
    try {
      ({ count } = await tx.user.updateMany({
        where: { id: state.id, version: state.version },
        data: {
          status: state.status,
          email: state.email,
          emailVerifiedAt: state.emailVerifiedAt,
          firstNames: state.firstNames,
          lastNames: state.lastNames,
          suspendedAt: state.suspendedAt,
          passwordHash: state.passwordHash,
          passwordChangedAt: state.passwordChangedAt,
          mustChangePassword: state.mustChangePassword,
          version: { increment: 1 },
        },
      }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateValueError('email');
      throw error;
    }
    if (count === 0) {
      const current = await tx.user.findUnique({
        where: { id: state.id },
        select: { version: true },
      });
      if (current === null) throw new Error(`User ${state.id} does not exist`);
      throw new VersionConflictError(current.version);
    }
    await tx.userRole.deleteMany({
      where: { userId: state.id, roleId: { notIn: [...state.roleIds] } },
    });
    if (state.roleIds.length > 0) {
      await tx.userRole.createMany({
        data: state.roleIds.map((roleId) => ({
          userId: state.id,
          roleId,
          assignedBy: changedBy,
        })),
        skipDuplicates: true,
      });
    }
    user.markSaved(state.version + 1);
  }

  countActiveStaffWithRole(roleId: RoleId, except?: UserId): Promise<number> {
    return this.txHost.tx.user.count({
      where: {
        type: 'STAFF',
        status: 'ACTIVE',
        ...(except === undefined ? {} : { id: { not: except } }),
        roles: { some: { roleId } },
      },
    });
  }
}

function toUser(row: UserRow): User {
  return User.restore({
    id: toId<'User'>(row.id),
    type: row.type,
    status: row.status,
    email: row.email,
    firstNames: row.firstNames,
    lastNames: row.lastNames,
    emailVerifiedAt: row.emailVerifiedAt,
    passwordHash: row.passwordHash,
    passwordChangedAt: row.passwordChangedAt,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    suspendedAt: row.suspendedAt,
    anonymizedAt: row.anonymizedAt,
    privacyNoticeVersion: row.privacyNoticeVersion,
    createdAt: row.createdAt,
    roleIds: row.roles.map(({ roleId }) => toId<'Role'>(roleId)),
    version: row.version,
  });
}
