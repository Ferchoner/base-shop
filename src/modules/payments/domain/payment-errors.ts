import { DomainError } from '../../../shared-kernel/index.js';

/** Manual payments are off in this environment (ADR-0040, E-23). Answered 403 `manual-payments-disabled`. */
export class ManualPaymentsDisabledError extends DomainError {
  readonly code = 'manual-payments-disabled';
  readonly category = 'forbidden';

  constructor() {
    super('Manual payments are disabled');
  }
}

/**
 * Restocking when the refund is registered comes with T-161, which decides how the lines of the order reach
 * Inventory (ADR-0135). Answered 409 `restock-not-allowed` with `reason: unavailable`, so the staff never
 * believes the stock came back.
 */
export class RestockUnavailableError extends DomainError {
  readonly code = 'restock-not-allowed';
  readonly category = 'conflict';

  constructor() {
    super('Restocking is not available yet', { reason: 'unavailable' });
  }
}

/**
 * The provider is not enabled: the manual method only when its variable turns it on, and PayPal never until it
 * is verified (ADR-0040, BR-PAY-13). Answered as a validation error of `provider`.
 */
export class ProviderNotEnabledError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(provider: string) {
    super(`Provider ${provider} is not enabled`, {
      errors: [
        {
          field: 'provider',
          code: 'isEnabledProvider',
          message: 'El método de pago no está habilitado.',
        },
      ],
    });
  }
}
