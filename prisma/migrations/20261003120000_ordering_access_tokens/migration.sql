-- Links that give access to the guest orders of an email (UC-ORD-05, ADR-0148): only the SHA-256 of the token, as
-- in `password_reset_tokens`. The daily cleanup deletes the ones expired, used or replaced, and anonymizing a guest
-- deletes those of their email (ADR-0067).
CREATE TABLE "order_access_tokens" (
    "id" UUID NOT NULL,
    "contact_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_access_tokens_token_hash_key" ON "order_access_tokens"("token_hash");

CREATE INDEX "order_access_tokens_contact_email_idx" ON "order_access_tokens"("contact_email");
