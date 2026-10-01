declare const tx: {
  order: { findMany(): Promise<unknown[]> };
  product: { findMany(): Promise<unknown[]> };
};

// Allowed: a model of its own context.
export const orders = () => tx.order.findMany();
// Violation: a model of Catalog.
export const products = () => tx.product.findMany();
