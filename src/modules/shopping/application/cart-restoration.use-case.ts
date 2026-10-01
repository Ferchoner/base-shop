import { Injectable } from '@nestjs/common';
import { Clock, TransactionManager } from '../../../shared-kernel/index.js';
import type { CartId, CartItem, CustomerId } from '../domain/cart.js';
import { CartRepository } from '../domain/cart.repository.js';

/** What putting the lines of an expired order back did. */
export type RestorationOutcome =
  /** The cart of the order is ACTIVE again. */
  | 'reactivated'
  /** The lines went into the customer's active cart, and the cart of the order is MERGED into it. */
  | 'merged'
  /** A repeated event: the cart of the order changed after the order expired, so nothing changed. */
  | 'already-restored'
  /** The cart of the order does not exist or is not the buyer's: nothing changed. */
  | 'unexpected';

/**
 * Puts the lines of an expired order back in a cart (UC-CRT-08, BR-CRT-10, ADR-0054, ADR-0137), when Ordering
 * says the order expired. Shopping never reads Ordering: the event brings the buyer, the cart and the lines.
 */
@Injectable()
export class CartRestoration {
  constructor(
    private readonly carts: CartRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /**
   * A guest gets the cart of the order back, ACTIVE again. A customer gets the lines in the active cart, up to
   * 30 units per line; without one, the cart of the order is ACTIVE again. The cart of the order is no longer
   * CHECKED_OUT afterwards, so a repeated event finds it changed and does nothing; one that arrives after the
   * buyer used the cart for another order finds it changed after `expiredAt`, and does nothing either.
   *
   * It locks the customer's active cart first, as every change of a customer's cart does, and then the cart of
   * the order (ADR-0131).
   */
  restoreExpiredOrder(order: {
    customerId: CustomerId | null;
    sourceCartId: CartId;
    lines: readonly CartItem[];
    expiredAt: Date;
  }): Promise<RestorationOutcome> {
    return this.transactions.run(async () => {
      const active =
        order.customerId === null
          ? null
          : await this.carts.lockActiveOf(order.customerId);
      const source = await this.carts.lock(order.sourceCartId);
      if (source === null || source.ownerId !== order.customerId) {
        return 'unexpected';
      }
      if (
        source.status !== 'CHECKED_OUT' ||
        source.lastActivityAt > order.expiredAt
      ) {
        return 'already-restored';
      }
      const now = this.clock.now();
      if (active === null) {
        source.reactivate(now);
        await this.carts.save(source);
        return 'reactivated';
      }
      active.absorbOrder(source, order.lines, now);
      await this.carts.save(active);
      await this.carts.save(source);
      return 'merged';
    });
  }
}
