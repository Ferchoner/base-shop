import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  type OrderAccessToken,
  type OrderAccessTokenId,
  OrderAccessTokenRepository,
} from '../domain/order-access-token.js';

/** Class of the advisory lock of an email, "ORDA", with the `hashtext` of the email (ADR-0148). */
export const ORDER_ACCESS_LOCK = 0x4f524441;

interface OrderAccessTokenRow {
  id: string;
  contactEmail: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
}

/** `order_access_tokens` (DATABASE.md §8.4), always through the active transaction. */
@Injectable()
export class PrismaOrderAccessTokenRepository extends OrderAccessTokenRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async lockEmail(contactEmail: string): Promise<void> {
    await this.txHost.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_ACCESS_LOCK}::int, hashtext(${contactEmail}))`;
  }

  async add(
    token: Omit<OrderAccessToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void> {
    await this.txHost.tx.orderAccessToken.create({ data: token });
  }

  async findByHashForUpdate(
    tokenHash: string,
  ): Promise<OrderAccessToken | null> {
    const [row] = await this.txHost.tx.$queryRaw<OrderAccessTokenRow[]>`
      SELECT id, contact_email AS "contactEmail", token_hash AS "tokenHash", expires_at AS "expiresAt",
             used_at AS "usedAt", invalidated_at AS "invalidatedAt"
      FROM order_access_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    return row === undefined
      ? null
      : { ...row, id: toId<'OrderAccessToken'>(row.id) };
  }

  async markUsed(id: OrderAccessTokenId, at: Date): Promise<void> {
    await this.txHost.tx.orderAccessToken.update({
      where: { id },
      data: { usedAt: at },
    });
  }

  async invalidatePendingOf(contactEmail: string, at: Date): Promise<void> {
    await this.txHost.tx.orderAccessToken.updateMany({
      where: { contactEmail, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: at },
    });
  }

  async deleteOf(contactEmail: string): Promise<void> {
    await this.lockEmail(contactEmail);
    await this.txHost.tx.orderAccessToken.deleteMany({
      where: { contactEmail },
    });
  }
}
