-- Transfers between warehouses (T-163, ADR-0172): units moved from one warehouse to another in one step, with a
-- folio, a reason and their lines. Never edited; cancelled only in their first 10 minutes.
-- CreateEnum
CREATE TYPE "stock_transfer_reason" AS ENUM ('SALE', 'RESTOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "stock_transfer_status" AS ENUM ('COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "transfer_id" UUID;

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "reason" "stock_transfer_reason" NOT NULL,
    "note" TEXT,
    "status" "stock_transfer_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "transfer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("transfer_id","variant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_number_key" ON "stock_transfers"("number");

-- CreateIndex
CREATE INDEX "stock_transfers_created_at_idx" ON "stock_transfers"("created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_from_warehouse_id_created_at_idx" ON "stock_transfers"("from_warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_to_warehouse_id_created_at_idx" ON "stock_transfers"("to_warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_variant_id_idx" ON "stock_transfer_lines"("variant_id");

-- CreateIndex
CREATE INDEX "stock_movements_transfer_id_idx" ON "stock_movements"("transfer_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Manual SQL (DATABASE.md §13).
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_warehouses_check" CHECK ("from_warehouse_id" <> "to_warehouse_id"),
  ADD CONSTRAINT "stock_transfers_note_check" CHECK (
    ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500) AND ("reason" <> 'OTHER' OR "note" IS NOT NULL)
  ),
  ADD CONSTRAINT "stock_transfers_cancelled_check" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL) AND ("cancelled_at" IS NULL) = ("cancelled_by" IS NULL)
  ),
  ADD CONSTRAINT "stock_transfers_version_check" CHECK ("version" >= 1);

ALTER TABLE "stock_transfer_lines"
  ADD CONSTRAINT "stock_transfer_lines_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100000);

-- A TRANSFER movement names its transfer, moves units and has no reason; no other movement names a transfer.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_transfer_check" CHECK (
    ("type" = 'TRANSFER') = ("transfer_id" IS NOT NULL) AND ("type" <> 'TRANSFER' OR "quantity" <> 0)
  );
