import type { Money } from '../../../shared-kernel/index.js';
import type { ShippingMethodId } from '../domain/shipping-method.js';

/** `ShippingMethod` of API_SPEC.md §17. */
export interface ShippingMethodView {
  readonly id: ShippingMethodId;
  readonly name: string;
  readonly flatFee: Money;
  readonly freeShippingThreshold: Money | null;
  readonly deliveryMinBusinessDays: number;
  readonly deliveryMaxBusinessDays: number;
  readonly isActive: boolean;
  readonly version: number;
  readonly updatedAt: Date;
}

/**
 * Read models of Shipping. An abstract class rather than an interface, so it can be the dependency injection
 * token without depending on NestJS.
 */
export abstract class ShippingQueries {
  abstract findActiveMethod(): Promise<ShippingMethodView | null>;
}
