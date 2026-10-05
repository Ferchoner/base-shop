// Operator script (UC-IAM-20, ADR-0043, ADR-0116): creates the first superadmin from SUPERADMIN_EMAIL,
// SUPERADMIN_FIRST_NAMES and SUPERADMIN_LAST_NAMES, and shows its temporary password once.
//   npm run superadmin:create
// In the production image, where the Nest CLI is not installed: node dist/scripts/create-first-superadmin.js
import { NestFactory } from '@nestjs/core';
import { FirstSuperadminCommand } from '../modules/identity-access/index.js';
import { AppLogger } from '../platform/logging/app-logger.js';
import { CreateFirstSuperadminScriptModule } from './create-first-superadmin.module.js';

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
