-- The counter sales that pay for a work order (T-189 part c, ADR-0167): one or several per work order, and one work
-- order at most per sale.
CREATE TABLE "work_order_sales" (
    "work_order_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "linked_by" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_order_sales_pkey" PRIMARY KEY ("work_order_id","order_id")
);

CREATE UNIQUE INDEX "work_order_sales_order_id_key" ON "work_order_sales"("order_id");

ALTER TABLE "work_order_sales" ADD CONSTRAINT "work_order_sales_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
