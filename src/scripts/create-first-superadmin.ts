// Operator script (UC-IAM-20, ADR-0043, ADR-0116): creates the first superadmin from SUPERADMIN_EMAIL,
// SUPERADMIN_FIRST_NAMES and SUPERADMIN_LAST_NAMES, and shows its temporary password once.
//   npm run superadmin:create
// In the production image, where the Nest CLI is not installed: node dist/scripts/create-first-superadmin.js
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from '../modules/audit/index.js';
import {
  FirstSuperadminCommand,
  IdentityAccessModule,
} from '../modules/identity-access/index.js';
import { AppCacheModule } from '../platform/cache/app-cache.module.js';
import { ClockModule } from '../platform/clock/clock.module.js';
import { validateEnvironment } from '../platform/config/environment.js';
import { RateLimitingModule } from '../platform/http/rate-limiting/rate-limiting.module.js';
import { AppLogger } from '../platform/logging/app-logger.js';
import { LoggingModule } from '../platform/logging/logging.module.js';
import { MailModule } from '../platform/mail/mail.module.js';
import { PersistenceModule } from '../platform/persistence/persistence.module.js';

/** What Identity & Access needs to start: no HTTP server, scheduler or event bus. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ClsModule.forRoot({ global: true }),
    LoggingModule,
    PersistenceModule,
    ClockModule,
    AppCacheModule,
    RateLimitingModule,
    MailModule,
    AuditModule,
    IdentityAccessModule,
  ],
})
class CreateFirstSuperadminScriptModule {}

const app = await NestFactory.createApplicationContext(
  CreateFirstSuperadminScriptModule,
  { bufferLogs: true },
);
app.useLogger(app.get(AppLogger));
try {
  process.exitCode = await app.get(FirstSuperadminCommand).run();
} finally {
  await app.close();
}
