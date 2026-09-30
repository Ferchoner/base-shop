// Public API of the Shipping context (ADR-0005): other modules import only from this file.
export { ShippingModule } from './shipping.module.js';
export {
  ShippingFacade,
  type ShippingQuote,
} from './application/shipping.facade.js';
export type { OrderAmounts } from './domain/shipping-rate-calculator.js';
