import { DomainError, type Money } from '../../../shared-kernel/index.js';

/**
 * The guest cart an order came from no longer exists or is no longer the guest's, so the staff cannot buy the order
 * again for the guest, and no other cart is created (ADR-0082, E-34). Answered 409 `source-cart-unavailable`.
 */
export class SourceCartUnavailableError extends DomainError {
  readonly code = 'source-cart-unavailable';
  readonly category = 'conflict';

  constructor() {
    super('The cart of the order is no longer available');
  }
}

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
 * Restocking when cancelling (ADR-0052, E-30) applies only to a PAID order: an unpaid one only releases its
 * reservation, and one waiting for stock never had it (ADR-0133). Answered 409 `restock-not-allowed` with
 * `currentStatus`.
 */
export class RestockNotAllowedError extends DomainError {
  readonly code = 'restock-not-allowed';
  readonly category = 'conflict';

  private constructor(
    message: string,
    details: Readonly<Record<string, unknown>>,
  ) {
    super(message, details);
  }

  /** The order is not PAID, so there is no sold stock to restock. */
  static notPaid(currentStatus: string): RestockNotAllowedError {
    return new RestockNotAllowedError(
      `Cannot restock an order in status ${currentStatus}`,
      { currentStatus },
    );
  }
}

/**
 * A restock names a line that is not of its order (UC-INV-09, ADR-0142). Answered as a validation error of
 * `lines[index].orderLineId`.
 */
export class UnknownOrderLineError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(index: number) {
    super(`Line ${index} of the restock is not of the order`, {
      errors: [
        {
          field: `lines[${index}].orderLineId`,
          code: 'orderLine',
          message: 'No es una línea de la orden.',
        },
      ],
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
