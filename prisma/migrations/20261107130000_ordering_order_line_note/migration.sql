-- What was sold on a line at the price the staff typed (T-182, ADR-0171); null on every other line, and on the lines of
-- the orders placed before.
ALTER TABLE "order_lines" ADD COLUMN "note" TEXT;

-- Manual SQL (DATABASE.md §13).
ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_note_length_check" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200);
