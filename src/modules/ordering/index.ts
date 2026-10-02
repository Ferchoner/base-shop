// Public API of the Ordering context (ADR-0005): other modules import only from this file.
// It exports the Nest module and the facade, with its public types.
export { OrderingModule } from './ordering.module.js';
export {
  type OrderNotice,
  type OrderNoticeLine,
  OrderingFacade,
} from './application/ordering.facade.js';
