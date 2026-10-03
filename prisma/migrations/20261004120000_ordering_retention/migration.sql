-- The retention cycle of the personal data of orders and shipments (T-232, ADR-0070, ADR-0149): when an order
-- concluded, and when its personal data, and its shipment's, was blocked.
ALTER TABLE "orders"
  ADD COLUMN "concluded_at" TIMESTAMPTZ(3),
  ADD COLUMN "blocked_at" TIMESTAMPTZ(3);

ALTER TABLE "shipments" ADD COLUMN "blocked_at" TIMESTAMPTZ(3);

-- Only a concluded order is blocked; reopening it clears both.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_blocked_at_check" CHECK (blocked_at IS NULL OR concluded_at IS NOT NULL);

-- The orders the daily retention job looks for: concluded, and not anonymized yet.
CREATE INDEX "orders_retention_idx" ON "orders"("concluded_at") WHERE (anonymized_at IS NULL);

-- The orders that concluded before this migration, as the domain sets it from now on (ADR-0145): DELIVERED, EXPIRED
-- and REFUNDED, a CANCELLED one without a payment, and a SHIPPED one whose shipment came back. The last one reads
-- `shipments` once, here only: from now on Shipping tells Ordering with ShipmentReturned (ADR-0005).
UPDATE "orders"
   SET "concluded_at" = CASE "status"
         WHEN 'DELIVERED' THEN "delivered_at"
         WHEN 'EXPIRED' THEN "expired_at"
         WHEN 'REFUNDED' THEN "refunded_at"
         WHEN 'CANCELLED' THEN CASE WHEN "paid_at" IS NULL THEN "cancelled_at" END
       END
 WHERE "status" IN ('DELIVERED', 'EXPIRED', 'REFUNDED', 'CANCELLED');

UPDATE "orders" AS o
   SET "concluded_at" = s."returned_at"
  FROM "shipments" AS s
 WHERE s."order_id" = o."id" AND o."status" = 'SHIPPED' AND s."status" = 'RETURNED';
