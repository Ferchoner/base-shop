-- Moving stock between warehouses (T-162, ADR-0160): an adjustment in each one with this reason, until transfers
-- are an operation of their own (T-163). PostgreSQL uses a new value of an enum only once it is committed, so the
-- next migration lets adjustments take it.
ALTER TYPE "stock_movement_reason" ADD VALUE 'WAREHOUSE_TRANSFER';
