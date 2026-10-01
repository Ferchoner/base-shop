// Allowed: the queries of the public store read Pricing and Inventory (ADR-0060), and only them.
export const STORE = `SELECT p.id FROM products p
  JOIN price_periods pp ON TRUE
  JOIN stock_items si ON TRUE`;
