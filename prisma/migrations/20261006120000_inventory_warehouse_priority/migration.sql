-- Several own warehouses (T-162, ADR-0160): each order is reserved in the first active warehouse that holds all of
-- it, by priority and then code. Any number of warehouses may be active now; the existing one becomes the first.
DROP INDEX "warehouses_single_active";

ALTER TABLE "warehouses" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_priority_check" CHECK (priority BETWEEN 1 AND 1000);
