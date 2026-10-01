import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { InventoryModule } from '../inventory/index.js';
import { PricingModule } from '../pricing/index.js';
import {
  CartCatalog,
  CartPrices,
  CartStock,
} from './application/cart-ports.js';
import { CartViews } from './application/cart-views.js';
import { Carts } from './application/carts.use-case.js';
import { CartRepository } from './domain/cart.repository.js';
import {
  CatalogFacadeCartCatalog,
  InventoryFacadeCartStock,
  PricingFacadeCartPrices,
} from './infrastructure/facade-adapters.js';
import { PrismaCartRepository } from './infrastructure/prisma-cart.repository.js';
import { CartsController } from './presentation/carts.controller.js';
import { MeCartController } from './presentation/me-cart.controller.js';

/**
 * Shopping bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. It uses Catalog, Pricing and
 * Inventory through their facades, and none of them uses Shopping, so they never form a cycle (ADR-0131).
 */
@Module({
  imports: [CatalogModule, PricingModule, InventoryModule],
  controllers: [CartsController, MeCartController],
  providers: [
    Carts,
    CartViews,
    { provide: CartRepository, useClass: PrismaCartRepository },
    { provide: CartCatalog, useClass: CatalogFacadeCartCatalog },
    { provide: CartPrices, useClass: PricingFacadeCartPrices },
    { provide: CartStock, useClass: InventoryFacadeCartStock },
  ],
})
export class ShoppingModule {}
