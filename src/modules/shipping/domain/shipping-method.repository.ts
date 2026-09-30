import type { ShippingMethod } from './shipping-method.js';

/**
 * The stored shipping method (DATABASE.md §10.1). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class ShippingMethodRepository {
  /** The active method; the MVP has exactly one (ADR-0042). */
  abstract findActive(): Promise<ShippingMethod | null>;

  /**
   * Saves the settings of the method. Rejects with `VersionConflictError` when another change was saved since
   * it was read (optimistic locking).
   */
  abstract save(method: ShippingMethod): Promise<void>;
}
