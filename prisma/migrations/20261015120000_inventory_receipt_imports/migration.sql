-- The bulk import of receipts (T-146 part b, ADR-0164): each file imported, by the SHA-256 of its bytes, so the
-- same file is not imported twice and the stock does not grow twice.
CREATE TABLE "stock_receipt_imports" (
    "id" UUID NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "rows" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_receipt_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_receipt_imports_file_sha256_key" ON "stock_receipt_imports"("file_sha256");

ALTER TABLE "stock_receipt_imports"
  ADD CONSTRAINT "stock_receipt_imports_file_sha256_check" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "stock_receipt_imports_rows_check" CHECK ("rows" > 0),
  ADD CONSTRAINT "stock_receipt_imports_units_check" CHECK ("units" > 0);
