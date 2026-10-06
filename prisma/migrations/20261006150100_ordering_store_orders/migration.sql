-- Assisted sales in the physical store (T-187, ADR-0161): a staff member places an order on behalf of a customer,
-- without a cart, with its stock from the warehouse they chose. Every existing order came from a cart of the online
-- store.
CREATE TYPE "order_channel" AS ENUM ('ONLINE', 'STORE');

ALTER TABLE "orders"
  ADD COLUMN "channel" "order_channel" NOT NULL DEFAULT 'ONLINE',
  ALTER COLUMN "source_cart_id" DROP NOT NULL,
  ADD COLUMN "placed_by" UUID,
  ADD COLUMN "warehouse_id" UUID;

-- An online order comes from a cart; a store order, from a staff member and the warehouse they chose.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_channel_check" CHECK (
    (channel = 'ONLINE' AND source_cart_id IS NOT NULL AND placed_by IS NULL AND warehouse_id IS NULL)
    OR (channel = 'STORE' AND source_cart_id IS NULL AND placed_by IS NOT NULL AND warehouse_id IS NOT NULL)
  );

-- The staff list filters the orders of a staff member, newest first.
CREATE INDEX "orders_placed_by_placed_at_idx" ON "orders" ("placed_by", "placed_at" DESC)
  WHERE placed_by IS NOT NULL;
