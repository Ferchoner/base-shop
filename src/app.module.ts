import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from './modules/catalog/index.js';
import { IdentityAccessModule } from './modules/identity-access/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { OrderingModule } from './modules/ordering/index.js';
import { PaymentsModule } from './modules/payments/index.js';
import { PricingModule } from './modules/pricing/index.js';
import { ShippingModule } from './modules/shipping/index.js';
import { ShoppingModule } from './modules/shopping/index.js';
import { validateEnvironment } from './platform/config/environment.js';
import { PersistenceModule } from './platform/persistence/persistence.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Tests read their variables only from the process, so a local .env cannot change their results.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
    PersistenceModule,
    IdentityAccessModule,
    CatalogModule,
    PricingModule,
    InventoryModule,
    ShoppingModule,
    OrderingModule,
    PaymentsModule,
    ShippingModule,
  ],
})
export class AppModule {}
