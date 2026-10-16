-- The blocked personal data of a work order (T-189 part c2, ADR-0167): the permission to read it, with a reason and
-- audited. The Administrador role gets it, as it has orders.read-blocked (ADR-0152); the Vendedor role does not, and
-- the superadmin role holds it implicitly (ADR-0111). The role is found by its id, and nothing is added if it was
-- deleted.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "id", 'work-orders.read-blocked'
  FROM "roles"
 WHERE "id" = '01a0ea00-c755-706d-9721-7e4a48b61d77'
ON CONFLICT DO NOTHING;
