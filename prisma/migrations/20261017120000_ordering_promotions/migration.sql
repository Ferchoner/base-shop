-- The promotions of orders (T-200 part b, ADR-0168): each line keeps what the promotion takes off it, with its VAT
-- on what is left, and the order keeps which promotion it got and the name the customer saw. Orders placed before
-- keep no discount and no promotion.
ALTER TABLE "order_lines" ADD COLUMN "discount_amount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN "promotion_id" UUID,
  ADD COLUMN "promotion_name" TEXT;

-- A line takes off at most its total, and its VAT is at most what is left.
ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_discount_amount_check" CHECK ("discount_amount" BETWEEN 0 AND "line_total"),
  ADD CONSTRAINT "order_lines_tax_amount_check" CHECK ("tax_amount" BETWEEN 0 AND "line_total" - "discount_amount");

-- The VAT of the order is at most its total, the discount at most the subtotal, the products pay at least one peso
-- with a discount, and the promotion comes with the discount, with its name.
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_check" CHECK ("subtotal" >= 0 AND "tax_total" >= 0 AND "tax_total" <= "subtotal" + "shipping_cost" - "discount_total" AND "shipping_cost" >= 0 AND "discount_total" >= 0 AND "discount_total" <= "subtotal"),
  ADD CONSTRAINT "orders_discount_minimum_check" CHECK ("discount_total" = 0 OR "subtotal" - "discount_total" >= 100),
  ADD CONSTRAINT "orders_promotion_check" CHECK (("promotion_id" IS NULL) = ("promotion_name" IS NULL) AND ("promotion_id" IS NULL) = ("discount_total" = 0));
