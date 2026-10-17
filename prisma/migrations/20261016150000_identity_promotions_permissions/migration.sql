-- Promotions (T-200 part a, ADR-0168): the permissions to read them and to manage them. The Administrador role,
-- which holds every permission but staff.manage and payments.configure (ADR-0043, ADR-0162), gets both; the Vendedor
-- role, which attends the counter (ADR-0161), only reads them, to know what to offer. The superadmin role holds them
-- implicitly (ADR-0111). Roles are edited in the database afterwards, so each role is found by its id, and nothing is
-- added to one that was deleted.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "roles"."id", code
  FROM "roles", unnest(ARRAY['promotions.read', 'promotions.manage']) AS code
 WHERE "roles"."id" = '01a0ea00-c755-706d-9721-7e4a48b61d77'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "roles"."id", 'promotions.read'
  FROM "roles"
 WHERE "roles"."id" = '01a11200-70b6-74a1-961d-f18533fd37bb'
ON CONFLICT DO NOTHING;
