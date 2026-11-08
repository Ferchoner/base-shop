-- Transfers between warehouses (T-163, ADR-0172): the permission to move stock from one warehouse to another and to
-- cancel the transfer in its first minutes. The Administrador role, which holds every permission but staff.manage and
-- payments.configure (ADR-0043, ADR-0162), and the Vendedor role, whose staff carries the products from one store to
-- the other (ADR-0161), get it. The superadmin role holds it implicitly (ADR-0111). Roles are edited in the database
-- afterwards, so each role is found by its id, and nothing is added to one that was deleted.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "roles"."id", 'inventory.transfer'
  FROM "roles"
 WHERE "roles"."id" IN ('01a0ea00-c755-706d-9721-7e4a48b61d77', '01a11200-70b6-74a1-961d-f18533fd37bb')
ON CONFLICT DO NOTHING;
