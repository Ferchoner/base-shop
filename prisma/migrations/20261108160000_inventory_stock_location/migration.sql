-- Where each stock item is in its warehouse (T-165, ADR-0173): an optional free text of 1 to 20 characters, kept
-- in upper case and trimmed (`A1`, `VITRINA 1`, `BODEGA`), with no closed list of locations. The index finds the
-- stock items of a location, or of a prefix, in one warehouse, as the count sheets of T-166 do. The application
-- puts it in upper case; the CHECK only backs its length and that it is trimmed, because the upper case of a few
-- letters differs between JavaScript and the collation of the database.
-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "location" VARCHAR(20);

-- CreateIndex
CREATE INDEX "stock_items_warehouse_id_location_idx" ON "stock_items"("warehouse_id", "location");

ALTER TABLE "stock_items"
  ADD CONSTRAINT "stock_items_location_check" CHECK (
    "location" IS NULL
    OR ("location" = btrim("location") AND char_length("location") BETWEEN 1 AND 20)
  );
