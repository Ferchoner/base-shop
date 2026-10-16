-- The retention of the personal data of work orders (T-189 part c2, ADR-0167): blocked and anonymized as orders are
-- (ADR-0151), counted from when the work order was delivered or cancelled. Once anonymized, a work order keeps no
-- name, phone nor reported fault of its customer.
ALTER TABLE "work_orders"
  ADD COLUMN "blocked_at" TIMESTAMPTZ(3),
  ADD COLUMN "anonymized_at" TIMESTAMPTZ(3),
  ALTER COLUMN "customer_name" DROP NOT NULL,
  ALTER COLUMN "customer_phone" DROP NOT NULL,
  ALTER COLUMN "reported_fault" DROP NOT NULL;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_customer_check"
    CHECK (anonymized_at IS NOT NULL OR (customer_name IS NOT NULL AND customer_phone IS NOT NULL AND reported_fault IS NOT NULL)),
  ADD CONSTRAINT "work_orders_blocked_at_check" CHECK (blocked_at IS NULL OR closed_at IS NOT NULL),
  ADD CONSTRAINT "work_orders_anonymized_at_check" CHECK (anonymized_at IS NULL OR closed_at IS NOT NULL);

CREATE INDEX "work_orders_retention_idx" ON "work_orders"("closed_at") WHERE (anonymized_at IS NULL);
