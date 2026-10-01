-- The public code of the order of each payment (ADR-0134): Ordering uses Payments and never the other way, so a
-- payment keeps the code it shows to the staff, which never changes. NOT NULL without a default: no payment
-- exists before T-190, so the table is empty.
ALTER TABLE "payments" ADD COLUMN "order_code" CHAR(8) NOT NULL;
