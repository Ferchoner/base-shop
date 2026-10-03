import { Injectable } from '@nestjs/common';
import type { IdempotencyScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { IdempotencyStore } from '../../../platform/http/idempotency/idempotency.store.js';
import { PlacementResponses } from '../application/placement-responses.js';
import type { Order } from '../domain/order.js';

/**
 * The responses of `@Idempotent` (ADR-0099): a customer's order is placed in the scope of the customer, and a guest's
 * in the scope of the cart it came from.
 */
@Injectable()
export class IdempotencyPlacementResponses extends PlacementResponses {
  constructor(private readonly store: IdempotencyStore) {
    super();
  }

  async forgetOf(orders: readonly Order[]): Promise<void> {
    const scopes = new Map<string, IdempotencyScope>();
    for (const { snapshot } of orders) {
      const scope: IdempotencyScope =
        snapshot.customerId === null
          ? { type: 'CART', id: snapshot.sourceCartId }
          : { type: 'USER', id: snapshot.customerId };
      scopes.set(`${scope.type} ${scope.id}`, scope);
    }
    await this.store.forget([...scopes.values()]);
  }
}
