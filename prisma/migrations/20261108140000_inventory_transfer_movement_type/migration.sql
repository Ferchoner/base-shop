-- Transfers between warehouses (T-163, ADR-0172): each side of a transfer is a movement of this type, signed and linked
-- to its transfer. PostgreSQL uses a new value of an enum only once it is committed, so the next migration, which
-- creates the transfers and the checks that name it, goes apart.
ALTER TYPE "stock_movement_type" ADD VALUE 'TRANSFER';
