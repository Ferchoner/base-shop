-- The permission to read the personal data of a blocked order, for a claim or a requirement (ADR-0070, ADR-0152): for
-- the Administrador role, which holds every permission but staff.manage (ADR-0043); the superadmin role holds it
-- implicitly (ADR-0111). Roles are edited in the database afterwards, so the Administrador role is found by its id,
-- and nothing is added if it was deleted.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "id", 'orders.read-blocked'
  FROM "roles"
 WHERE "id" = '01a0ea00-c755-706d-9721-7e4a48b61d77'
ON CONFLICT DO NOTHING;
