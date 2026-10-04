import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { ApiProblemResponses } from '../problem-details/api-problem-responses.decorator.js';
import type { IdempotencyScopeResolver } from './idempotency-scope.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_SCOPE,
  IdempotencyInterceptor,
} from './idempotency.interceptor.js';

/**
 * Makes an endpoint require `Idempotency-Key` (ADR-0063, ADR-0099). `scope` says who the key belongs to:
 * `cartScope` for guest routes and `userScope` for customer routes. It documents the header and its errors in
 * OpenAPI (ADR-0155).
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
      example: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
    }),
    ApiProblemResponses(
      'idempotency-key-missing',
      'idempotency-key-mismatch',
      'idempotency-request-in-progress',
    ),
  );
}
