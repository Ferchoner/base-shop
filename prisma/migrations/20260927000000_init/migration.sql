-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- ---------------------------------------------------------------------------
-- Manual SQL (DATABASE.md §13): objects Prisma cannot express, needed before the tables.
-- ---------------------------------------------------------------------------

-- Search without accents in the public catalog (ADR-0060).
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Exclusion constraint over (uuid, tstzrange) for price periods (ADR-0066).
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "variant_status" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "user_type" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'SALE', 'RESTOCK');

-- CreateEnum
CREATE TYPE "stock_movement_reason" AS ENUM ('PHYSICAL_COUNT', 'DAMAGED', 'LOSS_OR_THEFT', 'INTERNAL_USE', 'DATA_ENTRY_ERROR', 'OTHER', 'ORDER_CANCELLED', 'SHIPMENT_RETURNED');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'AWAITING_MANUAL_FULFILLMENT', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('MANUAL', 'PAYPAL');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "catalog_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'MERGED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "idempotency_scope" AS ENUM ('USER', 'CART');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "catalog_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "catalog_status" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "brand_id" UUID,
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "first_published_at" TIMESTAMPTZ(3),
    "search_vector" tsvector,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "product_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("product_id","category_id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "status" "variant_status" NOT NULL,
    "weight_grams" INTEGER,
    "length_cm" DECIMAL(7,1),
    "width_cm" DECIMAL(7,1),
    "height_cm" DECIMAL(7,1),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "alt_text" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "type" "user_type" NOT NULL,
    "email" TEXT,
    "first_names" TEXT,
    "last_names" TEXT,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "privacy_notice_version" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_superadmin" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "phone" CHAR(10) NOT NULL,
    "street" TEXT NOT NULL,
    "exterior_number" TEXT NOT NULL,
    "interior_number" TEXT,
    "neighborhood" TEXT NOT NULL,
    "postal_code" CHAR(5) NOT NULL,
    "state_code" CHAR(2) NOT NULL,
    "municipality_code" CHAR(5) NOT NULL,
    "city" TEXT,
    "references" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB,
    "status" "catalog_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "on_hand_after" INTEGER NOT NULL,
    "reason_code" "stock_movement_reason",
    "note" TEXT,
    "order_id" UUID,
    "order_line_id" UUID,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "reservation_status" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_lines" (
    "reservation_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "reservation_lines_pkey" PRIMARY KEY ("reservation_id","stock_item_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" BIGSERIAL NOT NULL,
    "public_code" CHAR(8) NOT NULL,
    "customer_id" UUID,
    "contact_email" TEXT,
    "status" "order_status" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax_total" INTEGER NOT NULL,
    "shipping_cost" INTEGER NOT NULL,
    "shipping_tax_amount" INTEGER NOT NULL,
    "shipping_tax_rate_bp" INTEGER NOT NULL,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL,
    "shipping_address" JSONB NOT NULL,
    "delivery_min_business_days" INTEGER NOT NULL,
    "delivery_max_business_days" INTEGER NOT NULL,
    "reservation_id" UUID,
    "source_cart_id" UUID NOT NULL,
    "privacy_notice_version" TEXT,
    "anonymized_at" TIMESTAMPTZ(3),
    "placed_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_options" JSONB NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "status" "payment_status" NOT NULL,
    "amount" INTEGER NOT NULL,
    "captured_amount" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "provider_payment_id" TEXT,
    "captured_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "status" "payment_status" NOT NULL,
    "provider_reference" TEXT,
    "failure_code" TEXT,
    "registered_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "refund_status" NOT NULL,
    "provider_refund_id" TEXT,
    "registered_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "provider" "payment_provider" NOT NULL,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("provider","event_id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL,
    "taxes_included" BOOLEAN NOT NULL DEFAULT true,
    "status" "catalog_status" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_prices" (
    "id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variant_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_periods" (
    "id" UUID NOT NULL,
    "variant_price_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "compare_at_amount" INTEGER,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_methods" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "flat_fee" INTEGER NOT NULL,
    "free_shipping_threshold" INTEGER,
    "delivery_min_business_days" INTEGER NOT NULL,
    "delivery_max_business_days" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "shipment_status" NOT NULL,
    "destination" JSONB NOT NULL,
    "anonymized_at" TIMESTAMPTZ(3),
    "carrier_name" TEXT,
    "tracking_number" TEXT,
    "own_delivery" BOOLEAN NOT NULL DEFAULT false,
    "dispatched_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "shipment_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("shipment_id","order_line_id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID,
    "status" "cart_status" NOT NULL,
    "merged_into_cart_id" UUID,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_lines" (
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_lines_pkey" PRIMARY KEY ("cart_id","variant_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "result" "audit_result" NOT NULL,
    "correlation_id" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "changes" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "scope_type" "idempotency_scope" NOT NULL,
    "scope_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("scope_type","scope_id","endpoint","key")
);

-- CreateTable
CREATE TABLE "geo_states" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "geo_states_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "geo_municipalities" (
    "code" CHAR(5) NOT NULL,
    "state_code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "geo_municipalities_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "products_status_published_at_idx" ON "products"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "product_categories_category_id_idx" ON "product_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_active_options_key" ON "product_variants"("product_id", "options") WHERE (status = 'ACTIVE'::variant_status);

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storage_key_key" ON "product_images"("storage_key");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_type_status_idx" ON "users"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "customer_addresses_user_id_idx" ON "customer_addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_addresses_one_default_per_user" ON "customer_addresses"("user_id") WHERE (is_default);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_single_active" ON "warehouses"("status") WHERE (status = 'ACTIVE'::catalog_status);

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_variant_id_warehouse_id_key" ON "stock_items"("variant_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_stock_item_id_created_at_idx" ON "stock_movements"("stock_item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_restock_by_order_line_idx" ON "stock_movements"("order_line_id") WHERE (type = 'RESTOCK'::stock_movement_type);

-- CreateIndex
CREATE INDEX "reservations_active_expiry_idx" ON "reservations"("expires_at") WHERE (status = 'ACTIVE'::reservation_status);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_one_active_per_order" ON "reservations"("order_id") WHERE (status = 'ACTIVE'::reservation_status);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_code_key" ON "orders"("public_code");

-- CreateIndex
CREATE INDEX "orders_customer_id_placed_at_idx" ON "orders"("customer_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_contact_email_idx" ON "orders"("contact_email");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_line_number_key" ON "order_lines"("order_id", "line_number");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_occurred_at_idx" ON "order_status_history"("order_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_updated_at_idx" ON "payments"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider", "provider_payment_id") WHERE (provider_payment_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_one_active_per_payment" ON "refunds"("payment_id") WHERE (status = ANY (ARRAY['PENDING'::refund_status, 'COMPLETED'::refund_status]));

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_code_key" ON "price_lists"("code");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_single_default" ON "price_lists"("is_default") WHERE (is_default);

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_active_priority" ON "price_lists"("priority") WHERE (status = 'ACTIVE'::catalog_status);

-- CreateIndex
CREATE INDEX "variant_prices_variant_id_idx" ON "variant_prices"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_prices_price_list_id_variant_id_key" ON "variant_prices"("price_list_id", "variant_id");

-- CreateIndex
CREATE INDEX "price_periods_variant_price_id_effective_from_idx" ON "price_periods"("variant_price_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_methods_single_active" ON "shipping_methods"("is_active") WHERE (is_active);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_status_created_at_idx" ON "shipments"("status", "created_at");

-- CreateIndex
CREATE INDEX "carts_guest_last_activity_idx" ON "carts"("last_activity_at") WHERE (owner_user_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "carts_one_active_per_owner" ON "carts"("owner_user_id") WHERE (status = 'ACTIVE'::cart_status AND owner_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_id_idx" ON "audit_logs"("occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_occurred_at_idx" ON "audit_logs"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "geo_municipalities_state_code_name_idx" ON "geo_municipalities"("state_code", "name");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_state_code_fkey" FOREIGN KEY ("state_code") REFERENCES "geo_states"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_municipality_code_fkey" FOREIGN KEY ("municipality_code") REFERENCES "geo_municipalities"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservation_lines" ADD CONSTRAINT "reservation_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservation_lines" ADD CONSTRAINT "reservation_lines_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "price_periods" ADD CONSTRAINT "price_periods_variant_price_id_fkey" FOREIGN KEY ("variant_price_id") REFERENCES "variant_prices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_merged_into_cart_id_fkey" FOREIGN KEY ("merged_into_cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geo_municipalities" ADD CONSTRAINT "geo_municipalities_state_code_fkey" FOREIGN KEY ("state_code") REFERENCES "geo_states"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Manual SQL (DATABASE.md §13): CHECK constraints, exclusion constraint,
-- expression indexes and the audit trigger. Prisma does not manage these objects.
-- ---------------------------------------------------------------------------

-- Identity & Access
ALTER TABLE "users"
  ADD CONSTRAINT "users_identity_required_check" CHECK (status = 'ANONYMIZED' OR (email IS NOT NULL AND password_hash IS NOT NULL AND first_names IS NOT NULL AND last_names IS NOT NULL)),
  ADD CONSTRAINT "users_staff_never_anonymized_check" CHECK (type = 'CUSTOMER' OR status <> 'ANONYMIZED');

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_phone_check" CHECK (phone ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "customer_addresses_postal_code_check" CHECK (postal_code ~ '^[0-9]{5}$');

-- Catalog
CREATE UNIQUE INDEX "brands_name_lower_key" ON "brands" (lower(name));

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_not_own_parent_check" CHECK (parent_id <> id);
-- NULLS NOT DISTINCT: two root categories cannot share a name either.
CREATE UNIQUE INDEX "categories_parent_name_lower_key" ON "categories" (parent_id, lower(name)) NULLS NOT DISTINCT;

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_weight_grams_check" CHECK (weight_grams > 0),
  ADD CONSTRAINT "product_variants_length_cm_check" CHECK (length_cm > 0),
  ADD CONSTRAINT "product_variants_width_cm_check" CHECK (width_cm > 0),
  ADD CONSTRAINT "product_variants_height_cm_check" CHECK (height_cm > 0);

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_content_type_check" CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "product_images_size_bytes_check" CHECK (size_bytes > 0 AND size_bytes <= 5242880);

-- Pricing
ALTER TABLE "price_lists"
  ADD CONSTRAINT "price_lists_currency_check" CHECK (currency = 'MXN'),
  ADD CONSTRAINT "price_lists_default_is_active_check" CHECK (NOT is_default OR status = 'ACTIVE');

ALTER TABLE "price_periods"
  ADD CONSTRAINT "price_periods_amount_check" CHECK (amount >= 0),
  ADD CONSTRAINT "price_periods_compare_at_amount_check" CHECK (compare_at_amount IS NULL OR compare_at_amount > amount),
  ADD CONSTRAINT "price_periods_effective_range_check" CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- No overlapping periods for the same variant price, even if application validation fails (BR-PRC-01).
  ADD CONSTRAINT "price_periods_no_overlap_excl" EXCLUDE USING gist (variant_price_id WITH =, tstzrange(effective_from, effective_to, '[)') WITH &&);

-- Inventory
ALTER TABLE "stock_items"
  ADD CONSTRAINT "stock_items_reserved_check" CHECK (reserved >= 0 AND reserved <= on_hand);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_check" CHECK (quantity <> 0),
  ADD CONSTRAINT "stock_movements_on_hand_after_check" CHECK (on_hand_after >= 0),
  ADD CONSTRAINT "stock_movements_reason_required_check" CHECK ((type IN ('ADJUSTMENT', 'RESTOCK')) = (reason_code IS NOT NULL)),
  ADD CONSTRAINT "stock_movements_adjustment_reason_check" CHECK (type <> 'ADJUSTMENT' OR reason_code IN ('PHYSICAL_COUNT', 'DAMAGED', 'LOSS_OR_THEFT', 'INTERNAL_USE', 'DATA_ENTRY_ERROR', 'OTHER')),
  ADD CONSTRAINT "stock_movements_restock_reason_check" CHECK (type <> 'RESTOCK' OR reason_code IN ('ORDER_CANCELLED', 'SHIPMENT_RETURNED')),
  ADD CONSTRAINT "stock_movements_decrease_only_reason_check" CHECK (reason_code NOT IN ('DAMAGED', 'LOSS_OR_THEFT', 'INTERNAL_USE') OR quantity < 0),
  ADD CONSTRAINT "stock_movements_other_needs_note_check" CHECK (reason_code <> 'OTHER' OR note IS NOT NULL),
  ADD CONSTRAINT "stock_movements_receipt_positive_check" CHECK (type <> 'RECEIPT' OR quantity > 0),
  ADD CONSTRAINT "stock_movements_sale_negative_check" CHECK (type <> 'SALE' OR quantity < 0),
  ADD CONSTRAINT "stock_movements_restock_reference_check" CHECK (type <> 'RESTOCK' OR (quantity > 0 AND order_id IS NOT NULL AND order_line_id IS NOT NULL));

ALTER TABLE "reservation_lines"
  ADD CONSTRAINT "reservation_lines_quantity_check" CHECK (quantity > 0);

-- Shopping
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_merged_target_check" CHECK (status <> 'MERGED' OR merged_into_cart_id IS NOT NULL);

ALTER TABLE "cart_lines"
  ADD CONSTRAINT "cart_lines_quantity_check" CHECK (quantity BETWEEN 1 AND 30);

-- Ordering
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_currency_check" CHECK (currency = 'MXN'),
  ADD CONSTRAINT "orders_amounts_check" CHECK (subtotal >= 0 AND tax_total >= 0 AND tax_total <= subtotal + shipping_cost AND shipping_cost >= 0 AND discount_total >= 0),
  ADD CONSTRAINT "orders_shipping_tax_check" CHECK (shipping_tax_amount >= 0 AND shipping_tax_amount <= shipping_cost AND shipping_tax_amount <= tax_total AND shipping_tax_rate_bp >= 0),
  ADD CONSTRAINT "orders_grand_total_check" CHECK (grand_total = subtotal + shipping_cost - discount_total),
  ADD CONSTRAINT "orders_delivery_days_check" CHECK (delivery_min_business_days > 0 AND delivery_max_business_days >= delivery_min_business_days),
  ADD CONSTRAINT "orders_public_code_check" CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  ADD CONSTRAINT "orders_contact_email_check" CHECK (anonymized_at IS NOT NULL OR contact_email IS NOT NULL),
  -- A guest order always records the privacy notice version it was shown (ADR-0067).
  ADD CONSTRAINT "orders_guest_privacy_notice_check" CHECK (customer_id IS NOT NULL OR anonymized_at IS NOT NULL OR privacy_notice_version IS NOT NULL);

ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_unit_price_check" CHECK (unit_price >= 0),
  ADD CONSTRAINT "order_lines_quantity_check" CHECK (quantity BETWEEN 1 AND 30),
  ADD CONSTRAINT "order_lines_tax_rate_bp_check" CHECK (tax_rate_bp >= 0),
  ADD CONSTRAINT "order_lines_line_total_check" CHECK (line_total = unit_price * quantity);

-- Payments
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK (amount > 0),
  ADD CONSTRAINT "payments_captured_amount_check" CHECK (captured_amount BETWEEN 0 AND amount),
  ADD CONSTRAINT "payments_refunded_amount_check" CHECK (refunded_amount BETWEEN 0 AND captured_amount),
  ADD CONSTRAINT "payments_currency_check" CHECK (currency = 'MXN');

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_check" CHECK (amount > 0);

-- Shipping
ALTER TABLE "shipping_methods"
  ADD CONSTRAINT "shipping_methods_flat_fee_check" CHECK (flat_fee >= 0),
  ADD CONSTRAINT "shipping_methods_free_shipping_threshold_check" CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold > 0),
  ADD CONSTRAINT "shipping_methods_delivery_days_check" CHECK (delivery_min_business_days > 0 AND delivery_max_business_days >= delivery_min_business_days);

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_dispatched_at_check" CHECK (status = 'PENDING' OR dispatched_at IS NOT NULL),
  -- Outside PENDING, a shipment has carrier and tracking number or is an own delivery (BR-SHP-04, ADR-0078).
  ADD CONSTRAINT "shipments_carrier_or_own_delivery_check" CHECK (status = 'PENDING' OR own_delivery OR (carrier_name IS NOT NULL AND tracking_number IS NOT NULL)),
  ADD CONSTRAINT "shipments_own_delivery_without_carrier_check" CHECK (NOT own_delivery OR (carrier_name IS NULL AND tracking_number IS NULL));

ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_quantity_check" CHECK (quantity > 0);

-- Cross-cutting
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_key_length_check" CHECK (char_length(key) BETWEEN 1 AND 255);

ALTER TABLE "geo_states"
  ADD CONSTRAINT "geo_states_code_check" CHECK (code ~ '^[0-9]{2}$');

ALTER TABLE "geo_municipalities"
  ADD CONSTRAINT "geo_municipalities_code_in_state_check" CHECK (left(code, 2) = state_code);

-- audit_logs is append-only: updates are rejected; only the retention job deletes rows (ADR-0037).
CREATE FUNCTION "audit_logs_reject_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (ADR-0037)';
END;
$$;

CREATE TRIGGER "audit_logs_no_update"
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "audit_logs_reject_update"();
