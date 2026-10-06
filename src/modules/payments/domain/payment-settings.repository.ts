import type { PaymentSettings } from './payment-settings.js';

/**
 * The stored settings of Payments (DATABASE.md §9, ADR-0162). An abstract class rather than an interface, so it
 * can be the dependency injection token without depending on NestJS.
 */
export abstract class PaymentSettingsRepository {
  /** The only row, which its migration creates. */
  abstract find(): Promise<PaymentSettings>;

  /**
   * Saves the settings. Rejects with `VersionConflictError` when another change was saved since they were read
   * (optimistic locking).
   */
  abstract save(settings: PaymentSettings): Promise<void>;
}
