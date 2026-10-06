import { Injectable } from '@nestjs/common';
import type { IdempotencyScope } from '../../../platform/http/idempotency/idempotency-scope.js';
import { IdempotencyStore } from '../../../platform/http/idempotency/idempotency.store.js';
import { PlacementResponses } from '../application/placement-responses.js';
import type { Order } from '../domain/order.js';

/** The route where the staff places an order on behalf of a customer, as `@Idempotent` keeps its responses. */
export const STAFF_PLACEMENT_ENDPOINT = 'POST /v1/admin/orders';

/**
 * The responses of `@Idempotent` (ADR-0099): a customer's order is placed in the scope of the customer, and a guest's
 * in the scope of the cart it came from. A store order is placed in the scope of the staff member, beside the other
 * responses of that member, so only the response of the order goes (ADR-0161).
 */
@Injectable()
export class IdempotencyPlacementResponses extends PlacementResponses {
  constructor(private readonly store: IdempotencyStore) {
    super();
  }

  async forgetOf(orders: readonly Order[]): Promise<void> {
    const scopes = new Map<string, IdempotencyScope>();
    const placedInStore: string[] = [];
    for (const { snapshot } of orders) {
      const scope: IdempotencyScope | null =
        snapshot.customerId !== null
          ? { type: 'USER', id: snapshot.customerId }
          : snapshot.sourceCartId === null
            ? null
            : { type: 'CART', id: snapshot.sourceCartId };
      if (scope !== null) scopes.set(`${scope.type} ${scope.id}`, scope);
      if (snapshot.channel === 'STORE') placedInStore.push(snapshot.id);
    }
    await this.store.forget([...scopes.values()]);
    await this.store.forgetResponsesOf(STAFF_PLACEMENT_ENDPOINT, placedInStore);
  }
}
