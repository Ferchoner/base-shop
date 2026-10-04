import type { RouteSecurity } from '../support/route-inventory.js';

/**
 * Every route of the API and how it is protected (T-310, ADR-0153): who may call it, its specific rate limits and
 * whose `Idempotency-Key` it requires. `route-matrix.e2e-spec.ts` compares it with the decorators of the running
 * application, so a new route, or a change in how one is protected, fails until it is reviewed and written here.
 */
export const ROUTE_MATRIX: Record<string, RouteSecurity> = {
  // Authentication (API_SPEC.md §9). Login is limited by its failed attempts, per email and per IP, not by a
  // decorator (ADR-0102).
  'POST /v1/auth/email-verification/confirm': { access: 'public' },
  'POST /v1/auth/email-verification/resend': {
    access: 'public',
    limits: ['email-verification'],
  },
  'POST /v1/auth/login': { access: 'public' },
  'POST /v1/auth/logout': { access: 'account, also with a temporary password' },
  'POST /v1/auth/password-reset/confirm': { access: 'public' },
  'POST /v1/auth/password-reset/request': {
    access: 'public',
    limits: ['password-reset-email', 'password-reset-ip'],
  },
  'POST /v1/auth/refresh': { access: 'public' },
  'POST /v1/auth/register': { access: 'public', limits: ['register'] },

  // The account of the caller, from the token (ADR-0036). Staff cannot buy: the use cases answer 403 `staff-
  // cannot-purchase` (ADR-0055).
  'GET /v1/me': { access: 'account, also with a temporary password' },
  'PATCH /v1/me': { access: 'customer' },
  'GET /v1/me/addresses': { access: 'customer' },
  'POST /v1/me/addresses': { access: 'customer' },
  'DELETE /v1/me/addresses/:addressId': { access: 'customer' },
  'PATCH /v1/me/addresses/:addressId': { access: 'customer' },
  'GET /v1/me/cart': { access: 'account' },
  'POST /v1/me/cart/lines': { access: 'account' },
  'DELETE /v1/me/cart/lines/:variantId': { access: 'account' },
  'PATCH /v1/me/cart/lines/:variantId': { access: 'account' },
  'POST /v1/me/cart/merge': { access: 'account' },
  'POST /v1/me/checkout/quote': { access: 'account' },
  'POST /v1/me/email': { access: 'customer', limits: ['email-verification'] },
  'GET /v1/me/orders': { access: 'customer' },
  'POST /v1/me/orders': {
    access: 'account',
    limits: ['place-order'],
    idempotent: 'user',
  },
  'GET /v1/me/orders/:publicCode': { access: 'customer' },
  'POST /v1/me/orders/:publicCode/payments': {
    access: 'account',
    idempotent: 'user',
  },
  'POST /v1/me/orders/:publicCode/reorder': { access: 'account' },
  'POST /v1/me/password': { access: 'account, also with a temporary password' },

  // Guest carts: the random `cartId` is their only credential, and a cart with an owner answers 404 (ADR-0059).
  'POST /v1/carts': { access: 'public' },
  'GET /v1/carts/:cartId': { access: 'public' },
  'POST /v1/carts/:cartId/lines': { access: 'public' },
  'DELETE /v1/carts/:cartId/lines/:variantId': { access: 'public' },
  'PATCH /v1/carts/:cartId/lines/:variantId': { access: 'public' },

  // Public catalog (API_SPEC.md §11).
  'GET /v1/catalog/brands': { access: 'public' },
  'GET /v1/catalog/categories': { access: 'public' },
  'GET /v1/catalog/products': { access: 'public' },
  'GET /v1/catalog/products/:slug': { access: 'public' },

  // Guest checkout (API_SPEC.md §15).
  'POST /v1/checkout/quote': { access: 'public' },

  // Geographic catalog (API_SPEC.md §10).
  'GET /v1/geo/states': { access: 'public' },
  'GET /v1/geo/states/:stateCode/municipalities': { access: 'public' },

  // Guest orders: the email and the public code travel in the body (ADR-0071), and the payment needs the cart of
  // origin.
  'POST /v1/orders': {
    access: 'public',
    limits: ['place-order'],
    idempotent: 'cart',
  },
  'POST /v1/orders/:publicCode/payments': {
    access: 'public',
    idempotent: 'cart',
  },
  'POST /v1/orders/access': { access: 'public', limits: ['guest-order'] },
  'POST /v1/orders/access-links': {
    access: 'public',
    limits: ['order-access-email', 'order-access-ip'],
  },
  'POST /v1/orders/lookup': { access: 'public', limits: ['guest-order'] },
  'POST /v1/orders/reorder': { access: 'public', limits: ['guest-order'] },

  // Retention policy (ADR-0152).
  'GET /v1/privacy/retention-policy': { access: 'public' },

  // Staff: audit, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/audit': { access: ['audit.read'] },

  // Staff: catalog, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/catalog/brands': { access: ['catalog.read'] },
  'POST /v1/admin/catalog/brands': { access: ['catalog.write'] },
  'DELETE /v1/admin/catalog/brands/:brandId': { access: ['catalog.write'] },
  'PATCH /v1/admin/catalog/brands/:brandId': { access: ['catalog.write'] },
  'POST /v1/admin/catalog/brands/:brandId/deactivate': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/brands/:brandId/reactivate': {
    access: ['catalog.write'],
  },
  'GET /v1/admin/catalog/categories': { access: ['catalog.read'] },
  'POST /v1/admin/catalog/categories': { access: ['catalog.write'] },
  'DELETE /v1/admin/catalog/categories/:categoryId': {
    access: ['catalog.write'],
  },
  'PATCH /v1/admin/catalog/categories/:categoryId': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/categories/:categoryId/deactivate': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/categories/:categoryId/reactivate': {
    access: ['catalog.write'],
  },
  'GET /v1/admin/catalog/products': { access: ['catalog.read'] },
  'POST /v1/admin/catalog/products': { access: ['catalog.write'] },
  'GET /v1/admin/catalog/products/:productId': { access: ['catalog.read'] },
  'PATCH /v1/admin/catalog/products/:productId': { access: ['catalog.write'] },
  'POST /v1/admin/catalog/products/:productId/archive': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/products/:productId/images': {
    access: ['catalog.write'],
  },
  'DELETE /v1/admin/catalog/products/:productId/images/:imageId': {
    access: ['catalog.write'],
  },
  'PATCH /v1/admin/catalog/products/:productId/images/:imageId': {
    access: ['catalog.write'],
  },
  'PUT /v1/admin/catalog/products/:productId/images/order': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/products/:productId/publish': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/products/:productId/reactivate': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/products/:productId/variants': {
    access: ['catalog.write'],
  },
  'PATCH /v1/admin/catalog/products/:productId/variants/:variantId': {
    access: ['catalog.write'],
  },
  'POST /v1/admin/catalog/products/:productId/variants/:variantId/discontinue':
    { access: ['catalog.write'] },
  'POST /v1/admin/catalog/products/:productId/variants/:variantId/reactivate': {
    access: ['catalog.write'],
  },

  // Staff: event-deliveries, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/event-deliveries': { access: ['events.manage'] },
  'POST /v1/admin/event-deliveries/:deliveryId/retry': {
    access: ['events.manage'],
  },
  'POST /v1/admin/event-deliveries/retry': { access: ['events.manage'] },

  // Staff: identity, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/identity/customers': { access: ['customers.read'] },
  'GET /v1/admin/identity/customers/:userId': { access: ['customers.read'] },
  'POST /v1/admin/identity/customers/:userId/anonymize': {
    access: ['customers.manage'],
  },
  'POST /v1/admin/identity/customers/:userId/reactivate': {
    access: ['customers.manage'],
  },
  'POST /v1/admin/identity/customers/:userId/suspend': {
    access: ['customers.manage'],
  },
  'POST /v1/admin/identity/guest-anonymizations': {
    access: ['customers.manage'],
  },
  'GET /v1/admin/identity/permissions': { access: ['staff.manage'] },
  'GET /v1/admin/identity/roles': { access: ['staff.manage'] },
  'POST /v1/admin/identity/roles': { access: ['staff.manage'] },
  'DELETE /v1/admin/identity/roles/:roleId': { access: ['staff.manage'] },
  'GET /v1/admin/identity/roles/:roleId': { access: ['staff.manage'] },
  'PATCH /v1/admin/identity/roles/:roleId': { access: ['staff.manage'] },
  'GET /v1/admin/identity/staff': { access: ['staff.manage'] },
  'POST /v1/admin/identity/staff': { access: ['staff.manage'] },
  'GET /v1/admin/identity/staff/:userId': { access: ['staff.manage'] },
  'POST /v1/admin/identity/staff/:userId/reactivate': {
    access: ['staff.manage'],
  },
  'PUT /v1/admin/identity/staff/:userId/roles': { access: ['staff.manage'] },
  'POST /v1/admin/identity/staff/:userId/suspend': { access: ['staff.manage'] },

  // Staff: inventory, with the permissions of the catalog in code (ADR-0111).
  'POST /v1/admin/inventory/adjustments': { access: ['inventory.write'] },
  'POST /v1/admin/inventory/receipts': { access: ['inventory.write'] },
  'GET /v1/admin/inventory/stock-items': { access: ['inventory.read'] },
  'GET /v1/admin/inventory/stock-items/:stockItemId/movements': {
    access: ['inventory.read'],
  },
  'GET /v1/admin/inventory/warehouses': { access: ['inventory.read'] },
  'PATCH /v1/admin/inventory/warehouses/:warehouseId': {
    access: ['inventory.write'],
  },

  // Staff: orders, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/orders': { access: ['orders.read'] },
  'GET /v1/admin/orders/:orderId': { access: ['orders.read'] },
  'POST /v1/admin/orders/:orderId/blocked-data': {
    access: ['orders.read-blocked'],
  },
  'POST /v1/admin/orders/:orderId/cancel': { access: ['orders.manage'] },
  'POST /v1/admin/orders/:orderId/manual-capture': {
    access: ['payments.manage'],
  },
  'POST /v1/admin/orders/:orderId/reorder': { access: ['orders.manage'] },
  'POST /v1/admin/orders/:orderId/restocks': {
    access: ['inventory.write'],
    idempotent: 'user',
  },
  'POST /v1/admin/orders/:orderId/retry-fulfillment': {
    access: ['orders.manage'],
  },

  // Staff: payments, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/payments': { access: ['orders.read'] },
  'GET /v1/admin/payments/:paymentId': { access: ['orders.read'] },
  'POST /v1/admin/payments/:paymentId/refunds/manual': {
    access: ['payments.manage'],
  },

  // Staff: pricing, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/pricing/price-lists': { access: ['pricing.read'] },
  'POST /v1/admin/pricing/price-lists/:priceListId/imports': {
    access: ['pricing.write'],
  },
  'GET /v1/admin/pricing/price-lists/:priceListId/variants/:variantId/periods':
    { access: ['pricing.read'] },
  'POST /v1/admin/pricing/price-lists/:priceListId/variants/:variantId/periods':
    { access: ['pricing.write'] },
  'DELETE /v1/admin/pricing/price-lists/:priceListId/variants/:variantId/periods/:periodId':
    { access: ['pricing.write'] },

  // Staff: shipping, with the permissions of the catalog in code (ADR-0111).
  'GET /v1/admin/shipping/method': { access: ['shipping.manage'] },
  'PUT /v1/admin/shipping/method': { access: ['shipping.configure'] },
  'GET /v1/admin/shipping/shipments': { access: ['shipping.manage'] },
  'GET /v1/admin/shipping/shipments/:shipmentId': {
    access: ['shipping.manage'],
  },
  'PATCH /v1/admin/shipping/shipments/:shipmentId': {
    access: ['shipping.manage'],
  },
  'POST /v1/admin/shipping/shipments/:shipmentId/deliver': {
    access: ['shipping.manage'],
  },
  'POST /v1/admin/shipping/shipments/:shipmentId/delivery-failure': {
    access: ['shipping.manage'],
  },
  'POST /v1/admin/shipping/shipments/:shipmentId/dispatch': {
    access: ['shipping.manage'],
  },
  'POST /v1/admin/shipping/shipments/:shipmentId/return': {
    access: ['shipping.manage'],
  },
};
