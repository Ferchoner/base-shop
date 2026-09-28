-- Initial staff roles (ADR-0043, ADR-0111). Roles are edited in the database afterwards (UC-IAM-15);
-- this migration only creates them once. No user is created here: the first superadmin comes from a
-- script (UC-IAM-20, T-131).
INSERT INTO "roles" ("id", "name", "description", "is_superadmin", "updated_at") VALUES
  ('01a0ea00-c750-7792-a69b-a7289f1a8f47', 'Superadministrador',
   'Todos los permisos, incluida la gestión del staff y de los roles.', true, CURRENT_TIMESTAMP),
  ('01a0ea00-c755-706d-9721-7e4a48b61d77', 'Administrador',
   'Todos los permisos excepto la gestión del staff y de los roles.', false, CURRENT_TIMESTAMP),
  ('01a0ea00-c755-706d-9721-83f80a3d8630', 'Operador',
   'Catálogo, precios, inventario, consulta de pedidos y clientes, y gestión de envíos.', false, CURRENT_TIMESTAMP);

-- The superadmin role has every permission implicitly (ADR-0111), so it has no rows here.

-- Administrador: every permission except staff.manage.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT '01a0ea00-c755-706d-9721-7e4a48b61d77', code
  FROM unnest(ARRAY[
    'catalog.read', 'catalog.write', 'pricing.read', 'pricing.write',
    'inventory.read', 'inventory.write', 'orders.read', 'orders.manage',
    'payments.manage', 'shipping.manage', 'shipping.configure',
    'customers.read', 'customers.manage', 'audit.read'
  ]) AS code;

-- Operador: catalog, pricing and inventory, orders.read, shipping.manage and customers.read.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT '01a0ea00-c755-706d-9721-83f80a3d8630', code
  FROM unnest(ARRAY[
    'catalog.read', 'catalog.write', 'pricing.read', 'pricing.write',
    'inventory.read', 'inventory.write', 'orders.read', 'shipping.manage',
    'customers.read'
  ]) AS code;
