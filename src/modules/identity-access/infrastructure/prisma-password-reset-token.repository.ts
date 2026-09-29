import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  type PasswordResetToken,
  type PasswordResetTokenId,
  PasswordResetTokenRepository,
} from '../domain/password-reset.js';
import type { UserId } from '../domain/user.js';

interface PasswordResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
}

/** `password_reset_tokens` (DATABASE.md §3.6), always through the active transaction. */
@Injectable()
export class PrismaPasswordResetTokenRepository extends PasswordResetTokenRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async add(
    token: Omit<PasswordResetToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void> {
    await this.txHost.tx.passwordResetToken.create({ data: token });
  }

  async findByHashForUpdate(
    tokenHash: string,
  ): Promise<PasswordResetToken | null> {
    const [row] = await this.txHost.tx.$queryRaw<PasswordResetTokenRow[]>`
      SELECT id, user_id AS "userId", token_hash AS "tokenHash", expires_at AS "expiresAt",
             used_at AS "usedAt", invalidated_at AS "invalidatedAt"
      FROM password_reset_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    return row === undefined
      ? null
      : {
          ...row,
          id: toId<'PasswordResetToken'>(row.id),
          userId: toId<'User'>(row.userId),
        };
  }

  async markUsed(id: PasswordResetTokenId, at: Date): Promise<void> {
    await this.txHost.tx.passwordResetToken.update({
      where: { id },
      data: { usedAt: at },
    });
  }

  async invalidatePendingOf(userId: UserId, at: Date): Promise<void> {
    await this.txHost.tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: at },
    });
  }
}
