// Public API of the Inventory context (ADR-0005): other modules import only from this file.
export { InventoryModule } from './inventory.module.js';
export {
  type CommitOutcome,
  InventoryFacade,
  type OrderId,
  type ReservationReceipt,
  type StockRequest,
} from './application/inventory.facade.js';
