-- The only price list of the MVP (ADR-0039, BR-PRC-06): general, default, in MXN with VAT included (ADR-0008,
-- ADR-0026) and active, so it can never be deactivated. Inserted only when no default list exists, so running
-- the migration again never adds a second one (ADR-0125).
INSERT INTO "price_lists" (
  "id", "code", "name", "currency", "priority", "is_default", "taxes_included", "status", "updated_at"
)
SELECT '01a0f4f2-bb5f-770a-a269-105d21861fe0', 'GENERAL', 'Lista general', 'MXN', 0, true, true, 'ACTIVE',
       CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "price_lists" WHERE "is_default");
