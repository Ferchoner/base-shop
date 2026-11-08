-- Cash closings (T-183, ADR-0171): one per warehouse and day of central Mexico, with the figures of the day, the cash
-- the staff counted and the difference. Inserted once and never changed.
CREATE TABLE "cash_closings" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "expected_cash" INTEGER NOT NULL,
    "counted_cash" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "note" TEXT,
    "summary" JSONB NOT NULL,
    "closed_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_closings_business_date_idx" ON "cash_closings"("business_date");

CREATE UNIQUE INDEX "cash_closings_warehouse_id_business_date_key" ON "cash_closings"("warehouse_id", "business_date");

-- Manual SQL (DATABASE.md §13).
ALTER TABLE "cash_closings"
  ADD CONSTRAINT "cash_closings_counted_cash_check" CHECK ("counted_cash" >= 0),
  ADD CONSTRAINT "cash_closings_difference_check" CHECK ("difference" = "counted_cash" - "expected_cash"),
  ADD CONSTRAINT "cash_closings_note_check" CHECK (
    ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500) AND ("difference" = 0 OR "note" IS NOT NULL)
  );
