import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { CatalogModule } from '../catalog/index.js';
import { GeoModule } from '../geo/index.js';
import { IdentityAccessModule } from '../identity-access/index.js';
import { InventoryModule } from '../inventory/index.js';
import { PaymentsModule } from '../payments/index.js';
import { PricingModule } from '../pricing/index.js';
import { ShippingModule } from '../shipping/index.js';
import { ShoppingModule } from '../shopping/index.js';
import {
  CheckoutCarts,
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutShipping,
  OrderStock,
  ShippingLocations,
} from './application/checkout-ports.js';
import { Checkout } from './application/checkout.use-case.js';
import { OrderLifecycle } from './application/order-lifecycle.use-case.js';
import { OrderPaymentRequests } from './application/order-payment-requests.use-case.js';
import { OrderReader } from './application/order-reader.js';
import { OrderingQueries } from './application/ordering.queries.js';
import { OrderPayments } from './application/payment-ports.js';
import { VAT_RATE_BP } from './application/vat-rate.js';
import { OrderRepository } from './domain/order.repository.js';
import {
  CatalogFacadeCheckoutCatalog,
  GeoShippingLocations,
  IdentityFacadeCheckoutCustomers,
  InventoryFacadeOrderStock,
  PaymentsFacadeOrderPayments,
  PricingFacadeCheckoutPrices,
  ShippingFacadeCheckoutShipping,
  ShoppingFacadeCheckoutCarts,
} from './infrastructure/facade-adapters.js';
import { PaymentCapturedHandler } from './infrastructure/payment-captured.event-handler.js';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository.js';
import { PrismaOrderingQueries } from './infrastructure/prisma-ordering.queries.js';
import { AdminOrdersController } from './presentation/admin-orders.controller.js';
import { CheckoutController } from './presentation/checkout.controller.js';
import { MeCheckoutController } from './presentation/me-checkout.controller.js';
import { MeOrdersController } from './presentation/me-orders.controller.js';
import { OrdersController } from './presentation/orders.controller.js';

/**
 * Ordering bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. It uses Shopping, Catalog,
 * Pricing, Inventory, Shipping, Identity & Access, Geo and Payments through their facades, and none of them uses
 * Ordering, so they never form a cycle (ADR-0132, ADR-0134).
 */
@Module({
  imports: [
    ShoppingModule,
    CatalogModule,
    PricingModule,
    InventoryModule,
    ShippingModule,
    IdentityAccessModule,
    GeoModule,
    PaymentsModule,
  ],
  controllers: [
    CheckoutController,
    MeCheckoutController,
    OrdersController,
    MeOrdersController,
    AdminOrdersController,
  ],
  providers: [
    {
      provide: VAT_RATE_BP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('VAT_RATE_BP', { infer: true }),
    },
    Checkout,
    OrderLifecycle,
    OrderPaymentRequests,
    OrderReader,
    PaymentCapturedHandler,
    { provide: OrderRepository, useClass: PrismaOrderRepository },
    { provide: OrderingQueries, useClass: PrismaOrderingQueries },
    { provide: CheckoutCarts, useClass: ShoppingFacadeCheckoutCarts },
    { provide: CheckoutCatalog, useClass: CatalogFacadeCheckoutCatalog },
    { provide: CheckoutPrices, useClass: PricingFacadeCheckoutPrices },
    { provide: OrderStock, useClass: InventoryFacadeOrderStock },
    { provide: CheckoutShipping, useClass: ShippingFacadeCheckoutShipping },
    { provide: CheckoutCustomers, useClass: IdentityFacadeCheckoutCustomers },
    { provide: ShippingLocations, useClass: GeoShippingLocations },
    { provide: OrderPayments, useClass: PaymentsFacadeOrderPayments },
  ],
})
export class OrderingModule {}
