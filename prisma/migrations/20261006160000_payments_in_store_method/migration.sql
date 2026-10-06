-- The payment in the physical store stops being only for tests (T-187, ADR-0161): a manual capture records how the
-- store collected it. The attempts written before, and those of a provider, have none.
CREATE TYPE "payment_method" AS ENUM ('CASH', 'CARD_TERMINAL', 'TRANSFER');

ALTER TABLE "payment_attempts" ADD COLUMN "method" "payment_method";

-- Only a captured attempt tells how the money came in.
ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_method_check" CHECK (method IS NULL OR status = 'CAPTURED');
