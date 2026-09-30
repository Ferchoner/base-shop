import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../platform/config/environment.js';
import { ConfigureShippingMethod } from './application/configure-shipping-method.use-case.js';
import { ShippingFacade } from './application/shipping.facade.js';
import { ShippingQueries } from './application/shipping.queries.js';
import { VAT_RATE_BP } from './application/vat-rate.js';
import { ShippingMethodRepository } from './domain/shipping-method.repository.js';
import { PrismaShippingMethodRepository } from './infrastructure/prisma-shipping-method.repository.js';
import { PrismaShippingQueries } from './infrastructure/prisma-shipping.queries.js';
import { AdminShippingMethodController } from './presentation/admin-shipping-method.controller.js';

/** Shipping bounded context (ADR-0004). Wires its layers; see docs/ARCHITECTURE.md. */
@Module({
  controllers: [AdminShippingMethodController],
  providers: [
    {
      provide: VAT_RATE_BP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('VAT_RATE_BP', { infer: true }),
    },
    ShippingFacade,
    ConfigureShippingMethod,
    {
      provide: ShippingMethodRepository,
      useClass: PrismaShippingMethodRepository,
    },
    { provide: ShippingQueries, useClass: PrismaShippingQueries },
  ],
  exports: [ShippingFacade],
})
export class ShippingModule {}
