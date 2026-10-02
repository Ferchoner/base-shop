-- The shipment of an order cancelled before it was dispatched becomes CANCELLED (ADR-0140). Alone in its migration,
-- because PostgreSQL does not let a transaction use an enum value it added.
ALTER TYPE "shipment_status" ADD VALUE 'CANCELLED';
