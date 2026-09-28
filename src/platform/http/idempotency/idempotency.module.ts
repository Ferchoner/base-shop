import { Global, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyStore } from './idempotency.store.js';

/**
 * Idempotency of HTTP requests (ADR-0099). Global, because each context's controllers instantiate the
 * interceptor through `@Idempotent` in their own module.
 */
@Global()
@Module({
  providers: [IdempotencyStore, IdempotencyInterceptor],
  exports: [IdempotencyStore, IdempotencyInterceptor],
})
export class IdempotencyModule {}
