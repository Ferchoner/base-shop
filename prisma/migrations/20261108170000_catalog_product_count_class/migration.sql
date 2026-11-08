-- How often each product is counted (T-166, ADR-0173): A every week, B every month and C every quarter. Optional: a
-- product without one is counted as C. The staff sets it by hand, or applies the one Ordering suggests from the sales
-- of the last 90 days.
-- CreateEnum
CREATE TYPE "product_count_class" AS ENUM ('A', 'B', 'C');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "count_class" "product_count_class";
