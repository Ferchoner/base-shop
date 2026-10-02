// Public API of the Shipping context (ADR-0005): other modules import only from this file.
export { ShippingModule } from './shipping.module.js';
export {
  type NewShipment,
  ShippingFacade,
  type ShippingQuote,
} from './application/shipping.facade.js';
export type { OrderShipmentView } from './application/shipping.queries.js';
export type { ShipmentAddress } from './domain/shipment.js';
export type { OrderAmounts } from './domain/shipping-rate-calculator.js';
