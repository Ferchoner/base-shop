import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { AppCache } from './app-cache.js';

/**
 * Cache of the application (ADR-0028, ADR-0104). The official NestJS integration is registered globally
 * with the same TTL, for response caching with its interceptor; AppCache adds namespaces that can be
 * invalidated on their own.
 */
@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        ttl: config.get('CACHE_TTL_SECONDS', { infer: true }) * 1000,
      }),
    }),
  ],
  providers: [AppCache],
  exports: [AppCache],
})
export class AppCacheModule {}
