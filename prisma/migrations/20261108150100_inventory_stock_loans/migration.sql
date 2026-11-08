-- Loans to show stock in another warehouse (T-164, ADR-0172): a transfer of kind LOAN with a time to come back, closed
-- with the units that came back, which return to the origin with a transfer linked to the loan.

-- CreateEnum
CREATE TYPE "stock_transfer_kind" AS ENUM ('TRANSFER', 'LOAN');

-- AlterTable
ALTER TABLE "stock_transfer_lines" ADD COLUMN     "returned" INTEGER;

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "closed_by" UUID,
ADD COLUMN     "kind" "stock_transfer_kind" NOT NULL DEFAULT 'TRANSFER',
ADD COLUMN     "loan_id" UUID,
ADD COLUMN     "return_by" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_loan_id_key" ON "stock_transfers"("loan_id");

-- CreateIndex
CREATE INDEX "stock_transfers_kind_status_return_by_idx" ON "stock_transfers"("kind", "status", "return_by");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Manual SQL (DATABASE.md §13).
-- A loan has a time to come back, the reason SHOW and its own statuses; only the return of a loan names it.
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_kind_check" CHECK (
    ("kind" = 'LOAN') = ("return_by" IS NOT NULL)
    AND ("kind" = 'LOAN') = ("reason" = 'SHOW')
    AND ("reason" = 'LOAN_RETURN') = ("loan_id" IS NOT NULL)
    AND (
      ("kind" = 'LOAN' AND "status" IN ('OPEN', 'CLOSED', 'CANCELLED'))
      OR ("kind" = 'TRANSFER' AND "status" IN ('COMPLETED', 'CANCELLED'))
    )
    AND (
      "return_by" IS NULL
      OR "return_by" BETWEEN "created_at" + interval '5 minutes' AND "created_at" + interval '24 hours'
    )
  ),
  ADD CONSTRAINT "stock_transfers_closed_check" CHECK (
    ("status" = 'CLOSED') = ("closed_at" IS NOT NULL) AND ("closed_at" IS NULL) = ("closed_by" IS NULL)
  );

ALTER TABLE "stock_transfer_lines"
  ADD CONSTRAINT "stock_transfer_lines_returned_check" CHECK ("returned" IS NULL OR "returned" BETWEEN 0 AND "quantity");
