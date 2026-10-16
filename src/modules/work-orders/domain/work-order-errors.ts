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
