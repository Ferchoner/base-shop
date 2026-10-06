-- Assisted sales in the physical store (T-187, ADR-0161): the permission to place orders on behalf of a customer.
-- The Administrador role, which holds every permission but staff.manage (ADR-0043), gets it; the superadmin role holds
-- it implicitly (ADR-0111). Roles are edited in the database afterwards, so the Administrador role is found by its id,
-- and nothing is added if it was deleted.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "id", 'orders.place'
  FROM "roles"
 WHERE "id" = '01a0ea00-c755-706d-9721-7e4a48b61d77'
ON CONFLICT DO NOTHING;

-- The Vendedor role places orders and reads what it needs for them, but does not record their payment
-- (payments.manage): whoever places an order does not confirm it was paid. A role an operator already named Vendedor
-- is left as it is, without these permissions.
INSERT INTO "roles" ("id", "name", "description", "is_superadmin", "updated_at") VALUES
  ('01a11200-70b6-74a1-961d-f18533fd37bb', 'Vendedor',
   'Pedidos en la tienda física a nombre de un cliente, y consulta de pedidos, clientes, catálogo e inventario.',
   false, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "roles"."id", code
  FROM "roles", unnest(ARRAY[
    'catalog.read', 'inventory.read', 'orders.read', 'orders.place', 'customers.read'
  ]) AS code
 WHERE "roles"."id" = '01a11200-70b6-74a1-961d-f18533fd37bb'
ON CONFLICT DO NOTHING;
