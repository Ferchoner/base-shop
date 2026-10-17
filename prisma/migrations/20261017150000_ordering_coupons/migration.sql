-- Coupons in orders (T-200 part c, ADR-0168): an order keeps the code of the coupon its customer used, and the uses of
-- a coupon by each customer are counted by the contact email of their orders.
ALTER TABLE "orders" ADD COLUMN "promotion_code" TEXT;

ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_code_check" CHECK ("promotion_code" IS NULL OR "promotion_id" IS NOT NULL);

CREATE INDEX "orders_promotion_contact_idx" ON "orders"("promotion_id", "contact_email") WHERE (promotion_id IS NOT NULL);
