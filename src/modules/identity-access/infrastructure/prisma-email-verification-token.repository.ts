import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  type EmailVerificationToken,
  type EmailVerificationTokenId,
  EmailVerificationTokenRepository,
} from '../domain/email-verification.js';
import type { UserId } from '../domain/user.js';

interface EmailVerificationTokenRow {
  id: string;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
}

/** `email_verification_tokens` (DATABASE.md §3.6), always through the active transaction. */
@Injectable()
export class PrismaEmailVerificationTokenRepository extends EmailVerificationTokenRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async add(
    token: Omit<EmailVerificationToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void> {
    await this.txHost.tx.emailVerificationToken.create({ data: token });
  }

  async findByHashForUpdate(
    tokenHash: string,
  ): Promise<EmailVerificationToken | null> {
    const [row] = await this.txHost.tx.$queryRaw<EmailVerificationTokenRow[]>`
      SELECT id, user_id AS "userId", email, token_hash AS "tokenHash", expires_at AS "expiresAt",
             used_at AS "usedAt", invalidated_at AS "invalidatedAt"
      FROM email_verification_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    return row === undefined
      ? null
      : {
          ...row,
          id: toId<'EmailVerificationToken'>(row.id),
          userId: toId<'User'>(row.userId),
        };
  }

  async markUsed(id: EmailVerificationTokenId, at: Date): Promise<void> {
    await this.txHost.tx.emailVerificationToken.update({
      where: { id },
      data: { usedAt: at },
    });
  }

  async invalidatePendingOf(userId: UserId, at: Date): Promise<void> {
    await this.txHost.tx.emailVerificationToken.updateMany({
      where: { userId, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: at },
    });
  }
}
