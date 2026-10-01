import { Injectable, Logger } from '@nestjs/common';
import { OnDomainEvent } from '../../../platform/events/on-domain-event.decorator.js';
import { type DomainEvent, toId } from '../../../shared-kernel/index.js';
import { CartRestoration } from '../application/cart-restoration.use-case.js';

/**
 * `OrderExpired` as Shopping reads it (ADR-0136, ADR-0137). Ordering publishes it; Shopping declares its own
 * type and subscribes by name, so it never imports Ordering (ARCHITECTURE.md).
 */
export interface OrderExpired extends DomainEvent<'OrderExpired'> {
  readonly orderId: string;
  /** `null` for a guest order. */
  readonly customerId: string | null;
  readonly sourceCartId: string;
  readonly lines: readonly {
    readonly variantId: string;
    readonly quantity: number;
  }[];
}

/**
 * Puts the lines of an expired order back in a cart (UC-CRT-08), in the background after the expiration
 * commits (ADR-0098, API_SPEC.md §2.5). A cart that does not exist or is not the buyer's goes to the log.
 */
@Injectable()
export class OrderExpiredHandler {
  private readonly logger = new Logger(OrderExpiredHandler.name);

  constructor(private readonly restoration: CartRestoration) {}

  @OnDomainEvent('OrderExpired')
  async onOrderExpired(event: OrderExpired): Promise<void> {
    const outcome = await this.restoration.restoreExpiredOrder({
      customerId:
        event.customerId === null ? null : toId<'User'>(event.customerId),
      sourceCartId: toId<'Cart'>(event.sourceCartId),
      lines: event.lines.map(({ variantId, quantity }) => ({
        variantId: toId<'Variant'>(variantId),
        quantity,
      })),
      expiredAt: event.occurredAt,
    });
    if (outcome === 'unexpected') {
      this.logger.error(
        `Cart ${event.sourceCartId} of expired order ${event.orderId} does not exist or is not its buyer's: its lines were not restored`,
      );
    }
  }
}
