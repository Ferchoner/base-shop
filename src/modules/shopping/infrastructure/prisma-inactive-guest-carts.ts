import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { InactiveGuestCarts } from '../application/guest-cart-cleanup.js';

/**
 * Inactive guest carts in `carts` (DATABASE.md §7.1), deleted in batches outside any transaction, with their lines
 * by cascade. The batch is chosen with the partial index of guest carts by last activity, and the `DELETE` checks
 * again that the cart is still a guest's and still inactive: one used meanwhile, which waited for its lock, stays.
 */
@Injectable()
export class PrismaInactiveGuestCarts extends InactiveGuestCarts {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  delete(before: Date, limit: number): Promise<number> {
    return this.txHost.tx.$executeRaw`
      DELETE FROM carts
       WHERE id IN (
             SELECT id FROM carts
              WHERE owner_user_id IS NULL AND last_activity_at < ${before}
              ORDER BY last_activity_at
              LIMIT ${limit})
         AND owner_user_id IS NULL
         AND last_activity_at < ${before}`;
  }
}
