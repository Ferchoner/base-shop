-- Products sold at the price the staff types on each line (T-182, ADR-0171), to charge at the counter what is not in
-- the catalog yet. Only a product sold only in the store has it, so it is never sold online.
ALTER TABLE "products" ADD COLUMN "open_price" BOOLEAN NOT NULL DEFAULT false;

-- Manual SQL (DATABASE.md §13).
ALTER TABLE "products"
  ADD CONSTRAINT "products_open_price_store_only_check" CHECK (NOT "open_price" OR "store_only");
