-- Coupons (T-200 part c, ADR-0168): a promotion with a code is a coupon, which never applies by itself. Its code is
-- kept in uppercase and is unique for good; a coupon may have a total limit of uses and be once per customer, and it
-- counts the orders that use it.
ALTER TABLE "promotions"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "usage_limit" INTEGER,
  ADD COLUMN "once_per_customer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "uses" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- The code as it is kept; a limit of one use or more; never fewer than no uses; and only a coupon has limits or uses.
-- The uses may pass the limit: a late payment counts its use again (ADR-0168).
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_code_check" CHECK ("code" ~ '^[A-Z0-9-]{4,30}$'),
  ADD CONSTRAINT "promotions_usage_limit_check" CHECK ("usage_limit" >= 1),
  ADD CONSTRAINT "promotions_uses_check" CHECK ("uses" >= 0),
  ADD CONSTRAINT "promotions_coupon_check" CHECK ("code" IS NOT NULL OR ("usage_limit" IS NULL AND NOT "once_per_customer" AND "uses" = 0));
