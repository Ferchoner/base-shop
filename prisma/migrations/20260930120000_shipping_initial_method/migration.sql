-- The only shipping method of the MVP, with the provisional values of ADR-0092: "Envío Estándar", $99.00 with
-- VAT included, free from $1,500.00 and 3 to 7 business days (ADR-0079, ADR-0083). Inserted only when no method
-- exists, so it never replaces what an administrator configured with PUT /v1/admin/shipping/method (ADR-0122).
INSERT INTO "shipping_methods" (
  "id", "name", "flat_fee", "free_shipping_threshold",
  "delivery_min_business_days", "delivery_max_business_days", "is_active", "updated_at"
)
SELECT '01a0f401-1b74-71ec-b896-7680a8d24293', 'Envío Estándar', 9900, 150000, 3, 7, true, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "shipping_methods");
