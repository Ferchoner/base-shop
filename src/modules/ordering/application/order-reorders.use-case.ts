import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  InvalidStateTransitionError,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type CartId,
  type CustomerId,
  normalizedContactEmail,
  type Order,
  type OrderId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { SourceCartUnavailableError } from '../domain/ordering-errors.js';
import type { PublicCode } from '../domain/public-code.js';
import { OrderingQueries } from './ordering.queries.js';
import {
  type CartCopy,
  ReorderCarts,
  type ReorderLine,
} from './reorder-ports.js';

/**
 * Buying a cancelled or refunded order again (UC-CRT-09, BR-CRT-11, ADR-0055, ADR-0139): its lines go into a cart,
 * with the prices and availability of now, and the order never changes. Each one reads the order locked, like
 * every use of it, and copies the lines in the same transaction.
 */
@Injectable()
export class OrderReorders {
  constructor(
    private readonly orders: OrderRepository,
    private readonly queries: OrderingQueries,
    private readonly carts: ReorderCarts,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * A customer buys one of their own orders again, in their active cart.
   *
   * @throws NotFoundError for an order that does not exist, is another customer's, or was blocked or anonymized;
   *   InvalidStateTransitionError.
   */
  forCustomer(input: {
    customerId: CustomerId;
    publicCode: PublicCode;
  }): Promise<CartCopy> {
    return this.transactions.run(async () => {
      const order = await this.orders.lockByPublicCode(input.publicCode);
      // Like the views of the customer: a blocked or anonymized order is not there (ADR-0070).
      if (
        order === null ||
        order.snapshot.customerId !== input.customerId ||
        order.isBlocked ||
        order.isAnonymized
      ) {
        throw new NotFoundError('Order', input.publicCode);
      }
      return this.carts.copyToCustomerCart(
        input.customerId,
        linesToReorder(order),
      );
    });
  }

  /**
   * A guest buys their order again, found with its code and contact email as the lookup finds it (ADR-0138), in
   * the active guest cart given or a new one.
   *
   * @throws NotFoundError alike for every miss of the order, and for a cart given that does not exist or has an
   *   owner; InvalidStateTransitionError; CartNotActiveError.
   */
  forGuest(input: {
    publicCode: PublicCode;
    contactEmail: string;
    cartId: CartId | null;
  }): Promise<CartCopy> {
    return this.transactions.run(async () => {
      const found = await this.queries.findGuestOrder(
        input.publicCode,
        normalizedContactEmail(input.contactEmail),
      );
      const order = found === null ? null : await this.orders.lock(found.id);
      if (order === null) {
        throw new NotFoundError('Guest order', 'with that email and code');
      }
      return this.carts.copyToGuestCart(input.cartId, linesToReorder(order));
    });
  }

  /**
   * The staff buys an order again for its buyer, never in a cart of its own (ADR-0055): a customer's goes into
   * the customer's active cart, and a guest's into the cart it came from, the one the guest knows (ADR-0082). A
   * guest order the staff placed in the store came from no cart, so it has none to go to (ADR-0161). Audited as
   * `orders.reorder`.
   *
   * @throws NotFoundError; InvalidStateTransitionError; SourceCartUnavailableError when the guest's cart is no
   *   longer available, or the guest order had none.
   */
  forStaff(orderId: OrderId): Promise<CartCopy> {
    return this.transactions.run(async () => {
      const order = await this.orders.lock(orderId);
      if (order === null) throw new NotFoundError('Order', orderId);
      const lines = linesToReorder(order);
      const { customerId, sourceCartId } = order.snapshot;
      const copy =
        customerId !== null
          ? await this.carts.copyToCustomerCart(customerId, lines)
          : sourceCartId === null
            ? null
            : await this.carts.copyToSourceCart(sourceCartId, lines);
      if (copy === null) throw new SourceCartUnavailableError();
      await this.audit.record({
        action: 'orders.reorder',
        resource: { type: 'order', id: order.id },
      });
      return copy;
    });
  }
}

/**
 * The lines of an order to buy again: only a CANCELLED or REFUNDED order can be (BR-CRT-11).
 *
 * @throws InvalidStateTransitionError for any other status.
 */
function linesToReorder(order: Order): ReorderLine[] {
  if (order.status !== 'CANCELLED' && order.status !== 'REFUNDED') {
    throw new InvalidStateTransitionError(order.status, 'reorder');
  }
  return order.snapshot.lines.map(({ variantId, quantity }) => ({
    variantId,
    quantity,
  }));
}
