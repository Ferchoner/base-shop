import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { AppLogger, createAppLogger } from './app-logger.js';

/** Provides AppLogger, which main.ts installs as the logger of the whole application (ADR-0097). */
@Global()
@Module({
  providers: [
    {
      provide: AppLogger,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        createAppLogger(
          config.get('NODE_ENV', { infer: true }),
          config.get('LOG_LEVEL', { infer: true }),
        ),
    },
  ],
  exports: [AppLogger],
})
export class LoggingModule {}
