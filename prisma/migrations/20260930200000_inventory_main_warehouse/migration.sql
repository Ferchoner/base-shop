-- The only warehouse of the MVP (ADR-0081, BR-INV-08): "Almacén principal", active and without an address, which
-- the staff sets with PATCH /v1/admin/inventory/warehouses/{warehouseId}. Inserted only when no warehouse
-- exists, so running the migration again never adds a second one (ADR-0127).
INSERT INTO "warehouses" ("id", "code", "name", "address", "status", "updated_at")
SELECT '01a0f54d-639d-7173-a3ff-f510cd91429d', 'PRINCIPAL', 'Almacén principal', NULL, 'ACTIVE', CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "warehouses");
