import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import {
  Cart,
  type CartId,
  type CartLine,
  type CartStatus,
  type CustomerId,
} from '../domain/cart.js';
import { CartRepository } from '../domain/cart.repository.js';

/** Class of the advisory locks of customers' carts ("CART"), next to the category tree's "CATT" (ADR-0120). */
const CUSTOMER_CART_LOCK = 0x43415254;

interface CartRow {
  id: string;
  owner_user_id: string | null;
  status: CartStatus;
  merged_into_cart_id: string | null;
  last_activity_at: Date;
  version: number;
}

/**
 * Carts in PostgreSQL (DATABASE.md §7, ADR-0131). Changes lock the cart row with `SELECT … FOR UPDATE`; the
 * cart of a customer is reached through an advisory lock of the customer first, so creating it, adopting a
 * guest cart and reading it never race, and the partial unique index of one active cart per customer is only a
 * backstop (BR-CRT-03). Dates come from the application, never from the database clock.
 */
@Injectable()
export class PrismaCartRepository extends CartRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async find(id: CartId): Promise<Cart | null> {
    const [row] = await this.txHost.tx.$queryRaw<CartRow[]>`
      SELECT id, owner_user_id, status, merged_into_cart_id, last_activity_at, version
        FROM carts WHERE id = ${id}::uuid`;
    return row === undefined ? null : this.withLines(row);
  }

  async findActiveOf(customer: CustomerId): Promise<Cart | null> {
    const [row] = await this.txHost.tx.$queryRaw<CartRow[]>`
      SELECT id, owner_user_id, status, merged_into_cart_id, last_activity_at, version
        FROM carts WHERE owner_user_id = ${customer}::uuid AND status = 'ACTIVE'`;
    return row === undefined ? null : this.withLines(row);
  }

  async lock(id: CartId): Promise<Cart | null> {
    const [row] = await this.txHost.tx.$queryRaw<CartRow[]>`
      SELECT id, owner_user_id, status, merged_into_cart_id, last_activity_at, version
        FROM carts WHERE id = ${id}::uuid
         FOR UPDATE`;
    return row === undefined ? null : this.withLines(row);
  }

  async lockActiveOf(customer: CustomerId): Promise<Cart | null> {
    // $executeRaw, because Prisma cannot read the `void` value that the function returns.
    await this.txHost.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(${CUSTOMER_CART_LOCK}::int, hashtext(${customer}))`;
    const [row] = await this.txHost.tx.$queryRaw<CartRow[]>`
      SELECT id, owner_user_id, status, merged_into_cart_id, last_activity_at, version
        FROM carts WHERE owner_user_id = ${customer}::uuid AND status = 'ACTIVE'
         FOR UPDATE`;
    return row === undefined ? null : this.withLines(row);
  }

  async insert(cart: Cart, now: Date): Promise<void> {
    await this.txHost.tx.cart.create({
      data: {
        id: cart.id,
        ownerUserId: cart.ownerId,
        status: cart.status,
        lastActivityAt: cart.lastActivityAt,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async save(cart: Cart): Promise<void> {
    const tx = this.txHost.tx;
    const at = cart.lastActivityAt;
    await tx.cart.update({
      where: { id: cart.id },
      data: {
        ownerUserId: cart.ownerId,
        status: cart.status,
        mergedIntoCartId: cart.mergedIntoCartId,
        lastActivityAt: at,
        version: { increment: 1 },
        updatedAt: at,
      },
    });
    const kept: CartLine[] = [];
    const removed: string[] = [];
    for (const variantId of cart.touchedVariants) {
      const line = cart.line(variantId);
      if (line === undefined) removed.push(variantId);
      else kept.push(line);
    }
    if (removed.length > 0) {
      await tx.cartLine.deleteMany({
        where: { cartId: cart.id, variantId: { in: removed } },
      });
    }
    if (kept.length > 0) {
      await tx.$executeRaw`
        INSERT INTO cart_lines (cart_id, variant_id, quantity, created_at, updated_at)
        SELECT ${cart.id}::uuid, line.variant_id, line.quantity, line.added_at, ${at}::timestamptz
          FROM unnest(
                 ${kept.map(({ variantId }) => variantId)}::uuid[],
                 ${kept.map(({ quantity }) => quantity)}::int[],
                 ${kept.map(({ addedAt }) => addedAt.toISOString())}::timestamptz[]
               ) AS line (variant_id, quantity, added_at)
        ON CONFLICT (cart_id, variant_id)
        DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = EXCLUDED.updated_at`;
    }
  }

  private async withLines(row: CartRow): Promise<Cart> {
    const lines = await this.txHost.tx.cartLine.findMany({
      where: { cartId: row.id },
    });
    return Cart.restore({
      id: toId<'Cart'>(row.id),
      ownerId:
        row.owner_user_id === null ? null : toId<'User'>(row.owner_user_id),
      status: row.status,
      mergedIntoCartId:
        row.merged_into_cart_id === null
          ? null
          : toId<'Cart'>(row.merged_into_cart_id),
      lastActivityAt: row.last_activity_at,
      version: row.version,
      lines: lines.map((line) => ({
        variantId: toId<'Variant'>(line.variantId),
        quantity: line.quantity,
        addedAt: line.createdAt,
      })),
    });
  }
}
