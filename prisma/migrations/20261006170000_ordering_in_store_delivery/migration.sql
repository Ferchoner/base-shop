-- Sales at the counter of the physical store (T-187 part b, ADR-0161): an order the staff hands over in the store,
-- right after it is paid, ships nowhere. It has no address, no shipping cost and no delivery time, and its buyer may
-- give no data at all. Every existing order ships.
CREATE TYPE "order_fulfillment" AS ENUM ('SHIPPING', 'IN_STORE');

ALTER TABLE "orders"
  ADD COLUMN "fulfillment" "order_fulfillment" NOT NULL DEFAULT 'SHIPPING',
  ALTER COLUMN "shipping_address" DROP NOT NULL,
  ALTER COLUMN "delivery_min_business_days" DROP NOT NULL,
  ALTER COLUMN "delivery_max_business_days" DROP NOT NULL;

-- An order that ships has its address and delivery time; one handed over in the store has neither, nor a shipping
-- cost, and only the staff places it.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_fulfillment_check" CHECK (
    (fulfillment = 'SHIPPING' AND shipping_address IS NOT NULL
      AND delivery_min_business_days IS NOT NULL AND delivery_max_business_days IS NOT NULL)
    OR (fulfillment = 'IN_STORE' AND channel = 'STORE' AND shipping_address IS NULL
      AND delivery_min_business_days IS NULL AND delivery_max_business_days IS NULL
      AND shipping_cost = 0 AND shipping_tax_amount = 0)
  );

-- A buyer who gives no data at all is only possible in a sale handed over in the store: no email, and no privacy
-- notice to record.
ALTER TABLE "orders"
  DROP CONSTRAINT "orders_contact_email_check",
  ADD CONSTRAINT "orders_contact_email_check" CHECK (
    anonymized_at IS NOT NULL OR contact_email IS NOT NULL
    OR (fulfillment = 'IN_STORE' AND customer_id IS NULL)
  ),
  DROP CONSTRAINT "orders_guest_privacy_notice_check",
  ADD CONSTRAINT "orders_guest_privacy_notice_check" CHECK (
    customer_id IS NOT NULL OR anonymized_at IS NOT NULL OR privacy_notice_version IS NOT NULL
    OR (fulfillment = 'IN_STORE' AND contact_email IS NULL)
  );
