import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

/** Sets `Cache-Control: no-store` before the handler runs, so its answer, an error included, carries it. */
@Injectable()
class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

/**
 * Public routes whose answers carry personal data or a credential, such as a guest order or the `cartId` of a guest
 * cart: browsers and proxies never store them (ADR-0071, T-310). Authenticated routes get the same header from the
 * authorization guard.
 */
export function NoStore(): ClassDecorator & MethodDecorator {
  return UseInterceptors(NoStoreInterceptor);
}
