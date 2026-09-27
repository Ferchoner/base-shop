/**
 * Current time for rules that depend on it, such as scheduled prices and expirations (ARCHITECTURE.md,
 * "Reloj"). Inject it instead of calling `new Date()`, so tests can fix the time.
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS. In tests, any object with `now()` fits: `{ now: () => fixedDate }`.
 */
export abstract class Clock {
  abstract now(): Date;
}
