-- The last activity of an account (T-232, ADR-0152): signing up, signing in or renewing the session, at most once a
-- day. Inactive customers are anonymized after INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS, when it is set (ADR-0149).
ALTER TABLE "users" ADD COLUMN "last_active_at" TIMESTAMPTZ(3);

-- The accounts that existed before: their last sign-in, or when they were created. Renewals were not recorded, so an
-- account in use only by renewing its session starts from its last sign-in, and its next renewal brings it up to date.
UPDATE "users" SET "last_active_at" = GREATEST("last_login_at", "created_at");

ALTER TABLE "users"
  ALTER COLUMN "last_active_at" SET NOT NULL,
  ALTER COLUMN "last_active_at" SET DEFAULT CURRENT_TIMESTAMP;

-- The customers the daily job looks for, the least recently active first.
CREATE INDEX "users_type_last_active_at_idx" ON "users"("type", "last_active_at");
