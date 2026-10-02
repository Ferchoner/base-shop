import { Global, Module } from '@nestjs/common';
import { IdempotencyCleanupJob } from './idempotency-cleanup.job.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyStore } from './idempotency.store.js';

/**
 * Idempotency of HTTP requests (ADR-0099). Global, because each context's controllers instantiate the
 * interceptor through `@Idempotent` in their own module. Expired keys go with the daily cleanup (ADR-0144).
 */
@Global()
@Module({
  providers: [IdempotencyStore, IdempotencyInterceptor, IdempotencyCleanupJob],
  exports: [IdempotencyStore, IdempotencyInterceptor],
})
export class IdempotencyModule {}
