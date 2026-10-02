import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { ConfigureShippingMethod } from './application/configure-shipping-method.use-case.js';
import { ShipmentTracking } from './application/shipment-tracking.use-case.js';
import { ShippingFacade } from './application/shipping.facade.js';
import { ShippingQueries } from './application/shipping.queries.js';
import { VAT_RATE_BP } from './application/vat-rate.js';
import { ShipmentRepository } from './domain/shipment.repository.js';
import { ShippingMethodRepository } from './domain/shipping-method.repository.js';
import { PrismaShipmentRepository } from './infrastructure/prisma-shipment.repository.js';
import { PrismaShippingMethodRepository } from './infrastructure/prisma-shipping-method.repository.js';
import { PrismaShippingQueries } from './infrastructure/prisma-shipping.queries.js';
import { AdminShipmentsController } from './presentation/admin-shipments.controller.js';
import { AdminShippingMethodController } from './presentation/admin-shipping-method.controller.js';

/**
 * Shipping bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. Ordering uses its facade to quote
 * the shipping and to create and cancel the shipment of an order, and Shipping never uses Ordering (ADR-0140).
 */
@Module({
  controllers: [AdminShippingMethodController, AdminShipmentsController],
  providers: [
    {
      provide: VAT_RATE_BP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('VAT_RATE_BP', { infer: true }),
    },
    ShippingFacade,
    ConfigureShippingMethod,
    ShipmentTracking,
    {
      provide: ShippingMethodRepository,
      useClass: PrismaShippingMethodRepository,
    },
    { provide: ShipmentRepository, useClass: PrismaShipmentRepository },
    { provide: ShippingQueries, useClass: PrismaShippingQueries },
  ],
  exports: [ShippingFacade],
})
export class ShippingModule {}
