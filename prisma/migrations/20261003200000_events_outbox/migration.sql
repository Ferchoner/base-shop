-- The outbox of domain events (ADR-0150): each event is stored in the transaction of the change that published it,
-- with one delivery per handler, so a failed handler is retried alone and no effect is lost when the API stops after
-- the commit. Delivered rows are deleted by the daily cleanup (T-109 part b).
CREATE TYPE "event_delivery_status" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "domain_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "handler" TEXT NOT NULL,
    "status" "event_delivery_status" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_deliveries_event_id_handler_key" ON "event_deliveries"("event_id", "handler");

-- The deliveries the retry job looks for: only the pending ones.
CREATE INDEX "event_deliveries_pending_idx" ON "event_deliveries"("next_attempt_at") WHERE (status = 'PENDING'::event_delivery_status);

ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_events"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- A delivered row has its date, and the attempts never go below zero.
ALTER TABLE "event_deliveries"
  ADD CONSTRAINT "event_deliveries_delivered_at_check" CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL),
  ADD CONSTRAINT "event_deliveries_attempts_check" CHECK (attempts >= 0);
