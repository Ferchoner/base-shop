-- Adjustments take WAREHOUSE_TRANSFER, in either direction (T-162, ADR-0160, ADR-0069).
ALTER TABLE "stock_movements"
  DROP CONSTRAINT "stock_movements_adjustment_reason_check",
  ADD CONSTRAINT "stock_movements_adjustment_reason_check" CHECK (type <> 'ADJUSTMENT' OR reason_code IN ('PHYSICAL_COUNT', 'DAMAGED', 'LOSS_OR_THEFT', 'INTERNAL_USE', 'DATA_ENTRY_ERROR', 'OTHER', 'WAREHOUSE_TRANSFER'));
