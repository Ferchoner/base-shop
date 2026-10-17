-- Promotions (T-200 part a, ADR-0168): a percentage or an amount off the whole purchase or certain products,
-- categories or brands, with its channels, an optional minimum purchase and its dates.
CREATE TYPE "promotion_target_type" AS ENUM ('PRODUCT', 'CATEGORY', 'BRAND');

CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" INTEGER,
    "amount_off" INTEGER,
    "online" BOOLEAN NOT NULL,
    "in_store" BOOLEAN NOT NULL,
    "minimum_subtotal" INTEGER,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" UUID,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promotion_targets" (
    "promotion_id" UUID NOT NULL,
    "target_type" "promotion_target_type" NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("promotion_id","target_type","target_id")
);

CREATE INDEX "promotions_starts_at_idx" ON "promotions"("starts_at" DESC);

CREATE INDEX "promotion_targets_target_type_target_id_idx" ON "promotion_targets"("target_type", "target_id");

ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Exactly one discount; at least one channel; the end after the start; ended by hand with who did it, or neither.
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_discount_check" CHECK (("percentage" IS NULL) <> ("amount_off" IS NULL)),
  ADD CONSTRAINT "promotions_percentage_check" CHECK ("percentage" BETWEEN 1 AND 100),
  ADD CONSTRAINT "promotions_amount_off_check" CHECK ("amount_off" > 0),
  ADD CONSTRAINT "promotions_channels_check" CHECK ("online" OR "in_store"),
  ADD CONSTRAINT "promotions_minimum_subtotal_check" CHECK ("minimum_subtotal" > 0),
  ADD CONSTRAINT "promotions_dates_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "promotions_ended_check" CHECK (("ended_at" IS NULL) = ("ended_by" IS NULL));
