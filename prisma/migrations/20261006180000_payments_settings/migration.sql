-- Manual payments enabled from the API (T-194, ADR-0162): whether the store takes them moves from the variable
-- MANUAL_PAYMENTS_ENABLED to the database, so a superadmin turns it on or off without a deployment.
CREATE TABLE "payment_settings" (
    "id" UUID NOT NULL,
    "manual_payments_enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

-- One row: its key is fixed, so no second row fits.
ALTER TABLE "payment_settings"
  ADD CONSTRAINT "payment_settings_single_row_check" CHECK (id = '01a11302-41ef-7d33-9e36-93a5239b19ba'::uuid);

-- Off, as the variable was by default (ADR-0040): a superadmin turns it on with PUT /v1/admin/payment-settings.
INSERT INTO "payment_settings" ("id", "manual_payments_enabled", "updated_at")
VALUES ('01a11302-41ef-7d33-9e36-93a5239b19ba', false, CURRENT_TIMESTAMP);
