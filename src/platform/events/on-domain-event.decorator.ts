import { SetMetadata } from '@nestjs/common';

export const ON_DOMAIN_EVENT = Symbol('on-domain-event');

/**
 * Marks a method of a provider as a handler of one domain event type (ADR-0098). Handlers are inbound
 * adapters in the infrastructure layer of the consuming context: they call a use case of that context,
 * must be idempotent, and run in the background after the publishing transaction commits.
 *
 * ```ts
 * @OnDomainEvent('OrderPaid')
 * async onOrderPaid(event: OrderPaid): Promise<void> { ... }
 * ```
 */
export function OnDomainEvent(eventType: string): MethodDecorator {
  return SetMetadata(ON_DOMAIN_EVENT, eventType);
}
