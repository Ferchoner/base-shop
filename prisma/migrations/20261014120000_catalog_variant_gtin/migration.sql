-- The barcode of the manufacturer of a variant (T-142, ADR-0163): an EAN or a UPC, which GS1 now calls GTIN.
ALTER TABLE "product_variants" ADD COLUMN "gtin" VARCHAR(14),
ADD COLUMN "gtin_key" CHAR(14);

-- 8, 12, 13 or 14 digits; the application checks the check digit. The key is the same code completed with zeros
-- to 14 digits, so a UPC and the same code as an EAN-13 with a leading 0 are one.
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_gtin_check" CHECK (gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  -- IS NOT DISTINCT FROM, so a key without its code, or a code without its key, fails instead of comparing to NULL.
  ADD CONSTRAINT "product_variants_gtin_key_check" CHECK (gtin_key IS NOT DISTINCT FROM lpad(gtin, 14, '0'));

-- No two active variants share a code; a discontinued one leaves it free for the variant that replaces it.
CREATE UNIQUE INDEX "product_variants_active_gtin_key" ON "product_variants"("gtin_key") WHERE (status = 'ACTIVE'::variant_status);
