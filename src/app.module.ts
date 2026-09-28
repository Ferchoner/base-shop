import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from './modules/audit/index.js';
import { CatalogModule } from './modules/catalog/index.js';
import { GeoModule } from './modules/geo/index.js';
import { IdentityAccessModule } from './modules/identity-access/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { OrderingModule } from './modules/ordering/index.js';
import { PaymentsModule } from './modules/payments/index.js';
import { PricingModule } from './modules/pricing/index.js';
import { ShippingModule } from './modules/shipping/index.js';
import { ShoppingModule } from './modules/shopping/index.js';
import { AppCacheModule } from './platform/cache/app-cache.module.js';
import { ClockModule } from './platform/clock/clock.module.js';
import { validateEnvironment } from './platform/config/environment.js';
import { EventsModule } from './platform/events/events.module.js';
import { IdempotencyModule } from './platform/http/idempotency/idempotency.module.js';
import { JobsModule } from './platform/jobs/jobs.module.js';
import { ProblemDetailsModule } from './platform/http/problem-details/problem-details.module.js';
import { RateLimitingModule } from './platform/http/rate-limiting/rate-limiting.module.js';
import { LoggingModule } from './platform/logging/logging.module.js';
import { MailModule } from './platform/mail/mail.module.js';
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
    // Async context per operation (ADR-0033): the active transaction and, for HTTP requests, the
    // correlation id, set by the middleware that configureHttp mounts (ADR-0095).
    ClsModule.forRoot({ global: true }),
    LoggingModule,
    PersistenceModule,
    EventsModule,
    JobsModule.forRoot(),
    ClockModule,
    AppCacheModule,
    MailModule,
    ProblemDetailsModule,
    IdempotencyModule,
    RateLimitingModule,
    AuditModule,
    GeoModule,
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
