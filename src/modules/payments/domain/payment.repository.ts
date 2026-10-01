import type { OrderId, Payment } from './payment.js';

/**
 * Persistence of payments (DATABASE.md §9). The caller holds the order locked (ADR-0134), so two changes of the
 * payment of one order never race. An abstract class rather than an interface, so it can be the dependency
 * injection token without depending on NestJS.
 */
export abstract class PaymentRepository {
  /** The payment of the order, with its attempts; `null` when it has none yet. */
  abstract findByOrder(orderId: OrderId): Promise<Payment | null>;

  /** Saves a new payment with its attempts. */
  abstract insert(payment: Payment, now: Date): Promise<void>;

  /**
   * Writes what changed and the new attempts, and counts one more version.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(payment: Payment, now: Date): Promise<void>;
}
