// Operator script (UC-IAM-21, ADR-0109): imports the INEGI municipal catalog into the database.
//   npm run geo:import -- data/inegi/municipios-2026-06.csv [--dry-run]
// In the production image, where the Nest CLI is not installed: node dist/scripts/import-geo-catalog.js <file>
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { AuditModule } from '../modules/audit/index.js';
import { GeoCatalogImportCommand, GeoModule } from '../modules/geo/index.js';
import { AppCacheModule } from '../platform/cache/app-cache.module.js';
import { ClockModule } from '../platform/clock/clock.module.js';
import { configModuleOptions } from '../platform/config/config-module-options.js';
import { AppLogger } from '../platform/logging/app-logger.js';
import { LoggingModule } from '../platform/logging/logging.module.js';
import { PersistenceModule } from '../platform/persistence/persistence.module.js';

/** Only what the import needs: no HTTP server, scheduler or event bus. */
@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions()),
    ClsModule.forRoot({ global: true }),
    LoggingModule,
    PersistenceModule,
    ClockModule,
    AppCacheModule,
    AuditModule,
    GeoModule,
  ],
})
class ImportGeoCatalogScriptModule {}

const app = await NestFactory.createApplicationContext(
  ImportGeoCatalogScriptModule,
  { bufferLogs: true },
);
app.useLogger(app.get(AppLogger));
try {
  process.exitCode = await app
    .get(GeoCatalogImportCommand)
    .run(process.argv.slice(2));
} finally {
  await app.close();
}
