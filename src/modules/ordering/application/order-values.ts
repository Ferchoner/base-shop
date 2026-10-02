// What the presentation layer needs of Ordering's domain, which it cannot import (ADR-0103).
export {
  ORDER_STATUSES,
  type OrderStatus,
  RESTOCK_REASONS,
  type RestockReason,
} from '../domain/order.js';
export {
  formatPublicCode,
  parsePublicCode,
  type PublicCode,
} from '../domain/public-code.js';
