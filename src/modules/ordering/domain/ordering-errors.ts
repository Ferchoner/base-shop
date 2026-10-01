import { DomainError, type Money } from '../../../shared-kernel/index.js';

/** An order needs at least one line (BR-ORD-01, E-33). Answered 409 `empty-cart`. */
export class EmptyCartError extends DomainError {
  readonly code = 'empty-cart';
  readonly category = 'conflict';

  constructor() {
    super('The cart has no lines');
  }
}

/** A customer needs a verified email to place an order (BR-USR-05, E-08). Answered 403 `email-not-verified`. */
export class EmailNotVerifiedError extends DomainError {
  readonly code = 'email-not-verified';
  readonly category = 'forbidden';

  constructor() {
    super('The customer has not verified their email');
  }
}

/**
 * Some lines cannot be sold now (E-10): their product is not published, the variant is discontinued or it has
 * no current price, all answered the same (ADR-0131). Answered 409 `variant-not-sellable` with `variantIds`.
 */
export class VariantNotSellableError extends DomainError {
  readonly code = 'variant-not-sellable';
  readonly category = 'conflict';

  constructor(variantIds: readonly string[]) {
    super('Some variants cannot be sold', { variantIds });
  }
}

/**
 * The total worked out now is not the one the customer accepted (BR-ORD-06, ADR-0019, E-06): the order is not
 * placed. Answered 409 `total-mismatch` with `currentTotal`, so the customer can quote again.
 */
export class TotalMismatchError extends DomainError {
  readonly code = 'total-mismatch';
  readonly category = 'conflict';

  constructor(currentTotal: Money) {
    super('The total of the order changed', {
      currentTotal: currentTotal.toJSON(),
    });
  }
}

/**
 * Restocking when cancelling applies only to a PAID order (ADR-0052, E-30): an unpaid one only releases its
 * reservation. Answered 409 `restock-not-allowed` with `currentStatus` (ADR-0133).
 */
export class RestockNotAllowedError extends DomainError {
  readonly code = 'restock-not-allowed';
  readonly category = 'conflict';

  constructor(currentStatus: string) {
    super(`Cannot restock an order in status ${currentStatus}`, {
      currentStatus,
    });
  }
}

/** What can be wrong with the state and municipality of an address (BR-ADR-02, BR-ADR-03). */
export type LocationProblem =
  'unknown-state' | 'municipality-not-in-state' | 'inactive-municipality';

const LOCATION_ERRORS: Record<
  LocationProblem,
  { field: string; code: string; message: string }
> = {
  'unknown-state': {
    field: 'shippingAddress.stateCode',
    code: 'isState',
    message: 'El estado no existe.',
  },
  'municipality-not-in-state': {
    field: 'shippingAddress.municipalityCode',
    code: 'isMunicipalityOfState',
    message: 'El municipio no pertenece al estado elegido.',
  },
  'inactive-municipality': {
    field: 'shippingAddress.municipalityCode',
    code: 'isActiveMunicipality',
    message:
      'El municipio ya no está en el catálogo del INEGI; elige uno vigente.',
  },
};

/**
 * The state or municipality of the shipping address is not valid (ADR-0057), as for a saved address.
 * Answered as a validation error of `shippingAddress`.
 */
export class InvalidShippingAddressError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(problem: LocationProblem) {
    super(`Invalid shipping address: ${problem}`, {
      errors: [LOCATION_ERRORS[problem]],
    });
  }
}
