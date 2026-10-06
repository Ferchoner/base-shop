// What the presentation layer needs of Payments' domain, which it cannot import (ADR-0103).
export {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentStatus,
} from '../domain/payment.js';
