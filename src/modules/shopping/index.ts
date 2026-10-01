// Public API of the Shopping context (ADR-0005): other modules import only from this file.
export { ShoppingModule } from './shopping.module.js';
export {
  type CheckoutCart,
  ShoppingFacade,
} from './application/shopping.facade.js';
export type { CartTarget } from './application/carts.use-case.js';
