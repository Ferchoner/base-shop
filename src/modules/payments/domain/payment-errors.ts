import { DomainError } from '../../../shared-kernel/index.js';

/** Manual payments are off (ADR-0040, ADR-0162, E-23). Answered 403 `manual-payments-disabled`. */
export class ManualPaymentsDisabledError extends DomainError {
  readonly code = 'manual-payments-disabled';
  readonly category = 'forbidden';

  constructor() {
    super('Manual payments are disabled');
  }
}

/**
 * The provider is not enabled: the manual method only while a superadmin keeps it on (ADR-0162), and PayPal never
 * until it is verified (ADR-0040, BR-PAY-13). Answered as a validation error of `provider`.
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
