import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './platform/config/environment.js';
import { configureHttp } from './platform/http/configure-http.js';
import { AppLogger } from './platform/logging/app-logger.js';

async function bootstrap() {
  // Logs written while the app starts wait for AppLogger, so they get its format too (ADR-0097).
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLogger));
  configureHttp(app);
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
