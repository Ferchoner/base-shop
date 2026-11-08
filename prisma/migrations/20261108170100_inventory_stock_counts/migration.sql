-- Count sheets (T-166, ADR-0173): variants of one warehouse that are counted, blind, reviewed and adjusted at once,
-- with a folio C-. A variant is in one open sheet per warehouse. Each line keeps what was counted and the units on hand
-- when it was counted, so the sales before or after it never show up as missing; applying the sheet writes one
-- PHYSICAL_COUNT adjustment, linked to it, per line with a difference.
-- CreateEnum
CREATE TYPE "stock_count_status" AS ENUM ('OPEN', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "stock_count_outcome" AS ENUM ('ADJUSTED', 'NO_DIFFERENCE', 'NOT_COUNTED', 'SKIPPED_RESERVED');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "count_id" UUID;

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "filter" JSONB NOT NULL,
    "note" TEXT,
    "status" "stock_count_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "count_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "location" VARCHAR(20),
    "counted" INTEGER,
    "expected" INTEGER,
    "counted_by" UUID,
    "counted_at" TIMESTAMPTZ(3),
    "recount" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "stock_count_outcome",
    "movement_id" UUID,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("count_id","variant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_number_key" ON "stock_counts"("number");

-- CreateIndex
CREATE INDEX "stock_counts_status_created_at_idx" ON "stock_counts"("status", "created_at");

-- CreateIndex
CREATE INDEX "stock_counts_warehouse_id_created_at_idx" ON "stock_counts"("warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_movement_id_key" ON "stock_count_lines"("movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_open_variant_key" ON "stock_count_lines"("warehouse_id", "variant_id") WHERE (open);

-- CreateIndex
CREATE INDEX "stock_movements_count_id_idx" ON "stock_movements"("count_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- Manual SQL (DATABASE.md §13).
ALTER TABLE "stock_counts"
  ADD CONSTRAINT "stock_counts_note_check" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500),
  ADD CONSTRAINT "stock_counts_closed_check" CHECK (
    ("status" = 'OPEN') = ("closed_by" IS NULL) AND ("closed_by" IS NULL) = ("closed_at" IS NULL)
  ),
  ADD CONSTRAINT "stock_counts_version_check" CHECK ("version" >= 1);

ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_counted_check" CHECK ("counted" IS NULL OR "counted" BETWEEN 0 AND 100000),
  ADD CONSTRAINT "stock_count_lines_expected_check" CHECK ("expected" IS NULL OR "expected" >= 0),
  ADD CONSTRAINT "stock_count_lines_capture_check" CHECK (
    ("counted" IS NULL) = ("expected" IS NULL)
    AND ("counted" IS NULL) = ("counted_by" IS NULL)
    AND ("counted" IS NULL) = ("counted_at" IS NULL)
  ),
  ADD CONSTRAINT "stock_count_lines_location_check" CHECK (
    "location" IS NULL OR ("location" = btrim("location") AND char_length("location") BETWEEN 1 AND 20)
  ),
  ADD CONSTRAINT "stock_count_lines_outcome_check" CHECK (NOT "open" OR "outcome" IS NULL),
  ADD CONSTRAINT "stock_count_lines_movement_check" CHECK (
    ("outcome" IS NOT DISTINCT FROM 'ADJUSTED') = ("movement_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "stock_count_lines_position_check" CHECK ("position" >= 1);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_count_check" CHECK (
    "count_id" IS NULL OR ("type" = 'ADJUSTMENT' AND "reason_code" = 'PHYSICAL_COUNT')
  );
