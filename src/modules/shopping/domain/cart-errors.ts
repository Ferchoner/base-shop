import { DomainError } from '../../../shared-kernel/index.js';

/** Only an active cart changes (BR-CRT-03, E-27). Answered 409 `cart-not-active` with `cartStatus`. */
export class CartNotActiveError extends DomainError {
  readonly code = 'cart-not-active';
  readonly category = 'conflict';

  constructor(cartStatus: string) {
    super(`The cart is ${cartStatus}`, { cartStatus });
  }
}

/**
 * The variant cannot go into a cart (E-10): it does not exist, its product is not published, it is
 * discontinued or it has no current price. The store answers all of them the same, so a draft is never
 * revealed (ADR-0131). Answered 409 `variant-not-sellable` with `variantIds`.
 */
export class VariantNotSellableError extends DomainError {
  readonly code = 'variant-not-sellable';
  readonly category = 'conflict';

  constructor(variantIds: readonly string[]) {
    super('The variant cannot be sold', { variantIds });
  }
}

/** A line holds from 1 to 30 units (BR-CRT-02, E-11). Answered as a validation error of `quantity`. */
export class LineQuantityError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(max: number) {
    super(`A line holds at most ${max} units`, {
      errors: [
        {
          field: 'quantity',
          code: 'lineQuantity',
          message: `La línea quedaría con más de ${max} unidades.`,
        },
      ],
    });
  }
}

/** The cart already has the most lines allowed (ADR-0131). Answered 409 `cart-line-limit-reached`. */
export class CartLineLimitError extends DomainError {
  readonly code = 'cart-line-limit-reached';
  readonly category = 'conflict';

  constructor(limit: number) {
    super(`A cart holds at most ${limit} lines`, { limit });
  }
}
