import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from '../modules/audit/index.js';
import { IdentityAccessModule } from '../modules/identity-access/index.js';
import { AppCacheModule } from '../platform/cache/app-cache.module.js';
import { ClockModule } from '../platform/clock/clock.module.js';
import { configModuleOptions } from '../platform/config/config-module-options.js';
import { EventsModule } from '../platform/events/events.module.js';
import { RateLimitingModule } from '../platform/http/rate-limiting/rate-limiting.module.js';
import { LoggingModule } from '../platform/logging/logging.module.js';
import { MailModule } from '../platform/mail/mail.module.js';
import { PersistenceModule } from '../platform/persistence/persistence.module.js';

/**
 * What Identity & Access needs to start for `create-first-superadmin`: no HTTP server or scheduler. Its use cases
 * publish domain events, so the publisher is here too; the events wait in the outbox until the API delivers them
 * (ADR-0150).
 */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions()),
    ClsModule.forRoot({ global: true }),
    LoggingModule,
    PersistenceModule,
    EventsModule,
    ClockModule,
    AppCacheModule,
    RateLimitingModule,
    MailModule,
    AuditModule,
    IdentityAccessModule,
  ],
})
export class CreateFirstSuperadminScriptModule {}
