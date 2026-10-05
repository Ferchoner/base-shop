import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from './modules/audit/index.js';
import { CatalogModule } from './modules/catalog/index.js';
import { GeoModule } from './modules/geo/index.js';
import { IdentityAccessModule } from './modules/identity-access/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { OrderingModule } from './modules/ordering/index.js';
import { PaymentsModule } from './modules/payments/index.js';
import { PricingModule } from './modules/pricing/index.js';
import { PrivacyModule } from './modules/privacy/index.js';
import { ShippingModule } from './modules/shipping/index.js';
import { ShoppingModule } from './modules/shopping/index.js';
import { AuthorizationModule } from './platform/auth/authorization.module.js';
import { AppCacheModule } from './platform/cache/app-cache.module.js';
import { ClockModule } from './platform/clock/clock.module.js';
import { configModuleOptions } from './platform/config/config-module-options.js';
import { RetentionPolicyModule } from './platform/config/retention-policy.js';
import { EventDeliveriesModule } from './platform/events/event-deliveries.module.js';
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
    ConfigModule.forRoot(configModuleOptions()),
    // Async context per operation (ADR-0033): the active transaction and, for HTTP requests, the
    // correlation id, set by the middleware that configureHttp mounts (ADR-0095).
    ClsModule.forRoot({ global: true }),
    LoggingModule,
    PersistenceModule,
    EventsModule,
    EventDeliveriesModule,
    JobsModule.forRoot(),
    ClockModule,
    RetentionPolicyModule,
    AppCacheModule,
    MailModule,
    ProblemDetailsModule,
    IdempotencyModule,
    // Global guards run in import order: authentication (in IdentityAccessModule, ADR-0114), then rate
    // limiting, which counts some limits per user (ADR-0102), then authorization (ADR-0111).
    IdentityAccessModule,
    RateLimitingModule,
    AuthorizationModule,
    AuditModule,
    GeoModule,
    CatalogModule,
    PricingModule,
    InventoryModule,
    ShoppingModule,
    OrderingModule,
    PaymentsModule,
    ShippingModule,
    NotificationsModule,
    PrivacyModule,
  ],
})
export class AppModule {}
