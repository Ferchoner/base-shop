import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { InventoryModule } from '../inventory/index.js';
import { PricingModule } from '../pricing/index.js';
import {
  CartCatalog,
  CartPrices,
  CartStock,
} from './application/cart-ports.js';
import { CartRestoration } from './application/cart-restoration.use-case.js';
import { CartViews } from './application/cart-views.js';
import { Carts } from './application/carts.use-case.js';
import { ShoppingFacade } from './application/shopping.facade.js';
import { CartRepository } from './domain/cart.repository.js';
import {
  CatalogFacadeCartCatalog,
  InventoryFacadeCartStock,
  PricingFacadeCartPrices,
} from './infrastructure/facade-adapters.js';
import { OrderExpiredHandler } from './infrastructure/order-expired.event-handler.js';
import { PrismaCartRepository } from './infrastructure/prisma-cart.repository.js';
import { CartsController } from './presentation/carts.controller.js';
import { MeCartController } from './presentation/me-cart.controller.js';

/**
 * Shopping bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. It uses Catalog, Pricing and
 * Inventory through their facades, and none of them uses Shopping, so they never form a cycle (ADR-0131).
 * Ordering uses its facade for the checkout (ADR-0132), and Shopping hears from Ordering only through
 * `OrderExpired` (ADR-0137).
 */
@Module({
  imports: [CatalogModule, PricingModule, InventoryModule],
  controllers: [CartsController, MeCartController],
  providers: [
    Carts,
    CartRestoration,
    CartViews,
    OrderExpiredHandler,
    ShoppingFacade,
    { provide: CartRepository, useClass: PrismaCartRepository },
    { provide: CartCatalog, useClass: CatalogFacadeCartCatalog },
    { provide: CartPrices, useClass: PricingFacadeCartPrices },
    { provide: CartStock, useClass: InventoryFacadeCartStock },
  ],
  exports: [ShoppingFacade],
})
export class ShoppingModule {}
