-- Products sold only in the physical store, such as services (T-189 part a, ADR-0165): the store, the cart, the
-- online checkout and reorders leave them out, and the counter sells them. Every product is sold online until marked.
ALTER TABLE "products" ADD COLUMN "store_only" BOOLEAN NOT NULL DEFAULT false;
