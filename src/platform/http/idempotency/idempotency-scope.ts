import { validate as isUuid } from 'uuid';

/** Who an idempotency key belongs to (ADR-0063): an authenticated user or, for guests, a cart. */
export interface IdempotencyScope {
  readonly type: 'USER' | 'CART';
  readonly id: string;
}

interface ScopedRequest {
  body?: unknown;
  user?: unknown;
}

/**
 * Finds the scope of a request. Returning undefined skips idempotency: the request is invalid anyway and
 * validation or authentication rejects it.
 */
export type IdempotencyScopeResolver = (
  request: ScopedRequest,
) => IdempotencyScope | undefined;

/** Guest routes: the `cartId` of the body. */
export const cartScope: IdempotencyScopeResolver = ({ body }) => {
  const cartId =
    typeof body === 'object' && body !== null && 'cartId' in body
      ? body.cartId
      : undefined;
  return typeof cartId === 'string' && isUuid(cartId)
    ? { type: 'CART', id: cartId.toLowerCase() }
    : undefined;
};

/**
 * Customer routes: the authenticated user, which authentication leaves in `request.user` with its `id`
 * (ADR-0114).
 */
export const userScope: IdempotencyScopeResolver = ({ user }) => {
  const userId =
    typeof user === 'object' && user !== null && 'id' in user
      ? user.id
      : undefined;
  return typeof userId === 'string' && isUuid(userId)
    ? { type: 'USER', id: userId.toLowerCase() }
    : undefined;
};
