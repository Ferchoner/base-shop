import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './platform/config/environment.js';
import { configureHttp } from './platform/http/configure-http.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
