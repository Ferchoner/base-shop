-- Work orders (T-189 part b, ADR-0165, ADR-0166): the service note of the equipment a customer leaves in the
-- store, with a consecutive folio, its customer, the equipment, the work and the history of its statuses.
CREATE TYPE "work_order_status" AS ENUM ('RECEIVED', 'DIAGNOSED', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED');

CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "status" "work_order_status" NOT NULL,
    "customer_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" CHAR(10) NOT NULL,
    "customer_email" TEXT,
    "equipment_type" TEXT NOT NULL,
    "equipment_brand" TEXT,
    "equipment_model" TEXT,
    "serial_number" TEXT,
    "accessories" TEXT,
    "equipment_condition" TEXT,
    "reported_fault" TEXT NOT NULL,
    "diagnosis" TEXT,
    "work_performed" TEXT,
    "estimated_cost" INTEGER,
    "warehouse_id" UUID NOT NULL,
    "received_by" UUID NOT NULL,
    "technician_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_status_history" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "from_status" "work_order_status",
    "to_status" "work_order_status" NOT NULL,
    "actor_id" UUID NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_order_status_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_orders_number_key" ON "work_orders"("number");

CREATE INDEX "work_orders_status_received_at_idx" ON "work_orders"("status", "received_at" DESC);

CREATE INDEX "work_orders_received_at_idx" ON "work_orders"("received_at" DESC);

CREATE INDEX "work_orders_customer_id_idx" ON "work_orders"("customer_id");

CREATE INDEX "work_order_status_history_work_order_id_occurred_at_idx" ON "work_order_status_history"("work_order_id", "occurred_at");

ALTER TABLE "work_order_status_history" ADD CONSTRAINT "work_order_status_history_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_customer_phone_check" CHECK ("customer_phone" ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "work_orders_estimated_cost_check" CHECK ("estimated_cost" >= 0);
