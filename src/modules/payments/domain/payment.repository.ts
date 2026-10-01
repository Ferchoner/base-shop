import type { OrderId, Payment, PaymentId } from './payment.js';

/**
 * Persistence of payments (DATABASE.md §9). The caller holds the order locked (ADR-0134), so two changes of the
 * payment of one order never race. An abstract class rather than an interface, so it can be the dependency
 * injection token without depending on NestJS.
 */
export abstract class PaymentRepository {
  /** The payment of the order, with its attempts; `null` when it has none yet. */
  abstract findByOrder(orderId: OrderId): Promise<Payment | null>;

  /**
   * The payment with this ID, locked until the transaction ends, so two registrations of its refund never
   * race (ADR-0135); `null` if it does not exist.
   */
  abstract lock(id: PaymentId): Promise<Payment | null>;

  /** Saves a new payment with its attempts. */
  abstract insert(payment: Payment, now: Date): Promise<void>;

  /**
   * Writes what changed, the new attempts and the refunds started or changed, and counts one more version.
   *
   * @throws VersionConflictError when the saved version is not the one read.
   */
  abstract save(payment: Payment, now: Date): Promise<void>;
}
