import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId, VersionConflictError } from '../../../shared-kernel/index.js';
import { User, type UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';

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
      include: { roles: { select: { roleId: true } } },
    });
    if (row === null) return null;
    return User.restore({
      id: toId<'User'>(row.id),
      type: row.type,
      status: row.status,
      email: row.email,
      firstNames: row.firstNames,
      lastNames: row.lastNames,
      emailVerifiedAt: row.emailVerifiedAt,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt,
      suspendedAt: row.suspendedAt,
      anonymizedAt: row.anonymizedAt,
      createdAt: row.createdAt,
      roleIds: row.roles.map(({ roleId }) => toId<'Role'>(roleId)),
      version: row.version,
    });
  }

  async save(user: User, changedBy: UserId | null): Promise<void> {
    const tx = this.txHost.tx;
    const state = user.snapshot();
    const { count } = await tx.user.updateMany({
      where: { id: state.id, version: state.version },
      data: {
        status: state.status,
        suspendedAt: state.suspendedAt,
        version: { increment: 1 },
      },
    });
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
}
