-- What the staff needs to pack a shipment, copied from its order when it is created, because Shipping never reads
-- Ordering (ADR-0140): the public code of the order, and the SKU and name of each item. NOT NULL without a
-- default: no shipment exists before T-195, so both tables are empty. And when a shipment was cancelled.
ALTER TABLE "shipments"
  ADD COLUMN "order_code" CHAR(8) NOT NULL,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(3);

ALTER TABLE "shipment_items"
  ADD COLUMN "sku" TEXT NOT NULL,
  ADD COLUMN "product_name" TEXT NOT NULL;

-- A cancelled shipment was never dispatched: like a pending one, it has no dispatch date, carrier nor tracking
-- number. It keeps when it was cancelled.
ALTER TABLE "shipments"
  DROP CONSTRAINT "shipments_dispatched_at_check",
  DROP CONSTRAINT "shipments_carrier_or_own_delivery_check",
  ADD CONSTRAINT "shipments_dispatched_at_check" CHECK (status IN ('PENDING', 'CANCELLED') OR dispatched_at IS NOT NULL),
  ADD CONSTRAINT "shipments_carrier_or_own_delivery_check" CHECK (status IN ('PENDING', 'CANCELLED') OR own_delivery OR (carrier_name IS NOT NULL AND tracking_number IS NOT NULL)),
  ADD CONSTRAINT "shipments_cancelled_at_check" CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL);
