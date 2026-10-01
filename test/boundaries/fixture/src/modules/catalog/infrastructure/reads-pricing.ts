// Allowed: its own tables, and words that are not tables.
export const OWN = `SELECT id FROM products JOIN product_variants ON TRUE`;
export const NOT_TABLES = `WITH offers AS (SELECT 1) SELECT * FROM offers`;
// Violation: a table of Pricing outside the queries of the store.
export const PRICES = `SELECT amount FROM price_periods`;
