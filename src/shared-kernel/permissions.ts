/**
 * Catalog of staff permissions (ADR-0017, ADR-0043, ADR-0075, ADR-0111): `<context>.<action>`. It lives in
 * code, in one place, so every layer of every context can use it without depending on the others; each
 * context owns its own entries. Roles are edited in the database, but can only hold these codes (BR-USR-04).
 * The descriptions are published by the API (`GET /v1/admin/identity/permissions`), so they are in Spanish.
 */
export const PERMISSIONS = {
  // Catalog
  'catalog.read':
    'Ver el catálogo administrativo, incluidos borradores y archivados',
  'catalog.write':
    'Gestionar productos, variantes, imágenes, categorías y marcas',
  // Pricing
  'pricing.read': 'Ver listas y precios',
  'pricing.write': 'Gestionar listas y precios',
  // Inventory
  'inventory.read': 'Ver almacenes, existencias y movimientos',
  'inventory.write': 'Registrar entradas y ajustes, y gestionar almacenes',
  // Ordering
  'orders.read': 'Ver pedidos',
  'orders.manage': 'Cancelar pedidos y resolver los que esperan surtido manual',
  // Payments
  'payments.manage': 'Registrar pagos manuales y emitir reembolsos',
  // Shipping
  'shipping.manage': 'Gestionar envíos (guías y estados)',
  'shipping.configure':
    'Configurar el costo de envío y el umbral de envío gratis',
  // Identity & Access
  'customers.read': 'Ver datos de clientes',
  'customers.manage': 'Suspender, reactivar y anonimizar clientes',
  'staff.manage': 'Gestionar cuentas del staff y roles',
  // Audit
  'audit.read': 'Consultar la auditoría',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

/** Every permission code, in catalog order. */
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);
}
