// What the presentation layer needs of Ordering's domain, which it cannot import (ADR-0103).
export {
  ORDER_CHANNELS,
  ORDER_FULFILLMENTS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderFulfillment,
  type OrderStatus,
  RESTOCK_REASONS,
  type RestockReason,
} from '../domain/order.js';
export {
  formatPublicCode,
  parsePublicCode,
  type PublicCode,
} from '../domain/public-code.js';
