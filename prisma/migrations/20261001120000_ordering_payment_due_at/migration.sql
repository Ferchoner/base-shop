-- When the reservation of an order ends (ADR-0132): an unpaid order expires then (BR-ORD-07), and the customer
-- sees it as `paymentDueAt`. It copies the `expires_at` of the reservation when the order is placed, which never
-- changes. NOT NULL without a default: no order exists before T-180, so the table is empty.
ALTER TABLE "orders" ADD COLUMN "payment_due_at" TIMESTAMPTZ(3) NOT NULL;
