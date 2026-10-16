import { DomainError } from '../../../shared-kernel/index.js';

/**
 * A sale that cannot pay for a work order (E-37, ADR-0167): it expired, was cancelled or was refunded. `saleStatus`
 * is the status of the sale, not of the work order.
 */
export class SaleNotLinkableError extends DomainError {
  readonly code = 'sale-not-linkable';
  readonly category = 'conflict';

  constructor(saleStatus: string) {
    super(`A sale in status ${saleStatus} cannot pay for a work order`, {
      saleStatus,
    });
  }
}

/**
 * The customer has a work order that was neither delivered nor cancelled (E-31, ADR-0167), so their account is not
 * anonymized, as with an order that has not concluded (ADR-0145).
 */
export class OpenWorkOrdersError extends DomainError {
  readonly code = 'active-orders-exist';
  readonly category = 'conflict';

  constructor() {
    super(
      'The customer has work orders that are neither delivered nor cancelled',
    );
  }
}
