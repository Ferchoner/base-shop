// Limits of the domain that the API validates first: presentation cannot import the domain (ADR-0103).
export {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
  MAX_NOTE_LENGTH,
  MAX_STOCK_QUANTITY,
  STOCK_MOVEMENT_REASONS,
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from '../domain/stock.js';
export {
  MAX_WAREHOUSE_NAME_LENGTH,
  MAX_WAREHOUSE_PRIORITY,
  MIN_WAREHOUSE_PRIORITY,
  WAREHOUSE_CODE,
} from '../domain/warehouse.js';
