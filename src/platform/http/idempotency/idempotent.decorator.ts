import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { IdempotencyScopeResolver } from './idempotency-scope.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_SCOPE,
  IdempotencyInterceptor,
} from './idempotency.interceptor.js';

/**
 * Makes an endpoint require `Idempotency-Key` (ADR-0063, ADR-0099). `scope` says who the key belongs to:
 * `cartScope` for guest routes and `userScope` for customer routes.
 *
 * ```ts
 * @Post()
 * @Idempotent(cartScope)
 * placeOrder(@Body() order: PlaceGuestOrderDto) { ... }
 * ```
 */
export function Idempotent(scope: IdempotencyScopeResolver): MethodDecorator {
  return applyDecorators(
    SetMetadata(IDEMPOTENCY_SCOPE, scope),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: IDEMPOTENCY_KEY_HEADER,
      required: true,
      description:
        'Llave de idempotencia de 1 a 255 caracteres; se recomienda un UUID (API_SPEC.md, sección 4).',
    }),
  );
}
