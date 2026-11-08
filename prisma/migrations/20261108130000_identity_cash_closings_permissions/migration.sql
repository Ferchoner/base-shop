-- Cash closings (T-183, ADR-0171): the permissions to read the summary and the closings, and to close the cash of a
-- day. The Administrador role, which holds every permission but staff.manage and payments.configure (ADR-0043,
-- ADR-0162), and the Vendedor role, which closes the cash of its store (ADR-0161), get both. The superadmin role holds
-- them implicitly (ADR-0111). Roles are edited in the database afterwards, so each role is found by its id, and nothing
-- is added to one that was deleted.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "roles"."id", code
  FROM "roles", unnest(ARRAY['cash-closings.read', 'cash-closings.manage']) AS code
 WHERE "roles"."id" IN ('01a0ea00-c755-706d-9721-7e4a48b61d77', '01a11200-70b6-74a1-961d-f18533fd37bb')
ON CONFLICT DO NOTHING;
