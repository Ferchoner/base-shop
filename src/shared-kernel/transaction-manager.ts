/**
 * Transaction boundary for use cases (ADR-0033, ADR-0093). Every repository call made while `work` runs joins
 * the same database transaction, which commits when `work` resolves and rolls back when it rejects. A `run`
 * inside another `run` joins the outer transaction. Never call external services inside `work`
 * (ARCHITECTURE.md, "Transacciones y concurrencia").
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class TransactionManager {
  abstract run<T>(work: () => Promise<T>): Promise<T>;

  /**
   * Runs `work` as one step of the transaction of the caller: it joins it, but when `work` rejects, only the
   * writes of `work` are undone and the caller's transaction goes on (ADR-0132). For an operation that must be
   * all or nothing on its own, such as a reservation, inside a larger transaction that may continue without
   * it. Without an active transaction it is `run`.
   */
  abstract runNested<T>(work: () => Promise<T>): Promise<T>;
}
