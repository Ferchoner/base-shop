import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Clock, type DomainEvent } from '../../shared-kernel/index.js';
import { redact } from '../logging/log-redaction.js';
import { EventOutbox } from './event-outbox.js';
import { fromPayload, toPayload } from './event-payload.js';
import { DELIVERY_BATCH_SIZE, MAX_DELIVERY_ATTEMPTS } from './event-retries.js';
import { ON_DOMAIN_EVENT } from './on-domain-event.decorator.js';

interface RegisteredHandler {
  /** `Class.method`: used in logs, and the handler of a stored delivery. */
  readonly name: string;
  readonly handle: (event: DomainEvent) => unknown;
}

/** What one run of the retry job did. */
export interface DeliveryRun {
  readonly delivered: number;
  readonly failed: number;
  /** Deliveries failed for good because their last attempt never finished. */
  readonly abandoned: number;
}

/** Characters of a failure kept in `event_deliveries.last_error`. */
const MAX_ERROR_LENGTH = 500;

/**
 * In-process event bus (ADR-0014, ADR-0098, ADR-0150). Finds the `@OnDomainEvent` methods at startup and runs them
 * in the background: one after another, in publish order, each isolated from the failures of the others.
 * - Stored events get one delivery per handler: right after the commit, each handler takes its own and runs, and one
 *   that fails is retried by the retry job (`deliverDue`) until its attempts run out.
 * - Volatile events (`publishVolatile`) are not stored nor retried: a failure only goes to the log.
 */
@Injectable()
export class DomainEventDispatcher
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(DomainEventDispatcher.name);
  private readonly handlers = new Map<string, RegisteredHandler[]>();
  private readonly handlersByName = new Map<string, RegisteredHandler>();
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (typeof instance !== 'object' || instance === null) continue;
      const prototype: object | null = Object.getPrototypeOf(instance);
      for (const method of this.scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, unknown>)[method];
        if (typeof handler !== 'function') continue;
        const eventType = this.reflector.get<string | undefined>(
          ON_DOMAIN_EVENT,
          handler as (...args: unknown[]) => unknown,
        );
        if (eventType === undefined) continue;
        this.register(eventType, {
          name: `${instance.constructor.name}.${method}`,
          handle: (event) =>
            (handler as (e: DomainEvent) => unknown).call(instance, event),
        });
      }
    }
  }

  /** Waits for in-flight handlers, so closing the app does not cut them off. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }

  /** The handlers of an event type, by the names their deliveries keep. */
  handlerNames(eventType: string): readonly string[] {
    return (this.handlers.get(eventType) ?? []).map(({ name }) => name);
  }

  /**
   * Runs the handlers of volatile `events` in the background, within the current async context, so their logs keep
   * the correlation id of the request that published them. It reads `events` on the next turn of the event loop, so a
   * batch can still grow until then (ClsDomainEventPublisher).
   */
  dispatchInBackground(events: readonly DomainEvent[]): void {
    this.runInBackground(() => this.dispatch(events));
  }

  /** Runs `work` in the background, on the next turn of the event loop, tracked by `whenIdle`. */
  runInBackground(work: () => Promise<void>): void {
    const task = new Promise<void>((resolve) => {
      setImmediate(() => {
        void work()
          .catch((error: unknown) => {
            this.logger.error(
              'Background event work failed',
              error instanceof Error ? error.stack : String(error),
            );
          })
          .finally(resolve);
      });
    });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /** Resolves when no handler is running, including those of events published by other handlers. */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(this.pending);
    }
  }

  /**
   * One run of the retry job (ADR-0150): fails for good the deliveries whose last attempt never finished, then takes
   * up to DELIVERY_BATCH_SIZE due ones and runs them, oldest event first. A delivery to a handler that is no longer
   * registered fails for good.
   */
  async deliverDue(): Promise<DeliveryRun> {
    const now = this.clock.now();
    const abandoned = await this.outbox.failAbandoned(now);
    if (abandoned > 0) {
      this.logger.error(
        `${abandoned} event deliveries failed for good: their last attempt did not finish`,
      );
    }
    let delivered = 0;
    let failed = 0;
    for (const delivery of await this.outbox.claimDue(
      now,
      DELIVERY_BATCH_SIZE,
    )) {
      const handler = this.handlersByName.get(delivery.handler);
      if (handler === undefined) {
        await this.outbox.markFailedAttempt(
          delivery.id,
          MAX_DELIVERY_ATTEMPTS,
          this.clock.now(),
          `Handler ${delivery.handler} is not registered`,
        );
        this.logger.error(
          `Handler ${delivery.handler} is not registered: its delivery of ${delivery.event.eventType} ${delivery.event.eventId} failed for good`,
        );
        failed += 1;
      } else if (await this.attempt(handler, delivery.event, delivery)) {
        delivered += 1;
      } else {
        failed += 1;
      }
    }
    if (delivered + failed > 0) {
      this.logger.log(
        `Retried ${delivered + failed} event deliveries: ${delivered} delivered, ${failed} failed`,
      );
    }
    return { delivered, failed, abandoned };
  }

  private register(eventType: string, handler: RegisteredHandler): void {
    this.handlers.set(eventType, [
      ...(this.handlers.get(eventType) ?? []),
      handler,
    ]);
    this.handlersByName.set(handler.name, handler);
  }

  /** Runs the handlers of volatile `events` now, logging the failures: nothing is stored nor retried. */
  async dispatch(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = this.handlers.get(event.eventType) ?? [];
      if (handlers.length === 0) {
        this.logger.debug(`No handler for ${event.eventType} ${event.eventId}`);
      }
      for (const handler of handlers) {
        try {
          await handler.handle(event);
        } catch (error) {
          this.logger.error(
            `Handler ${handler.name} failed for ${event.eventType} ${event.eventId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }
  }

  /**
   * Delivers stored `events` now, right after their commit: each handler takes its pending delivery first, so the
   * retry job never runs it at the same time, and gets the event as the retry job would read it back, so both give
   * it the same values.
   */
  async deliver(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      const stored = fromPayload(toPayload(event));
      for (const handler of this.handlers.get(event.eventType) ?? []) {
        let delivery: { id: string; attempts: number } | null;
        try {
          delivery = await this.outbox.claim(
            event.eventId,
            handler.name,
            this.clock.now(),
          );
        } catch (error) {
          this.logger.error(
            `Delivery of ${event.eventType} ${event.eventId} to ${handler.name} could not be taken; the retry job will`,
            error instanceof Error ? error.stack : String(error),
          );
          continue;
        }
        // Taken by the retry job, or already settled.
        if (delivery !== null) await this.attempt(handler, stored, delivery);
      }
    }
  }

  /** Runs one attempt of a delivery and settles it; answers whether it was delivered. */
  private async attempt(
    handler: RegisteredHandler,
    event: DomainEvent,
    delivery: { readonly id: string; readonly attempts: number },
  ): Promise<boolean> {
    try {
      await handler.handle(event);
    } catch (error) {
      await this.recordFailure(handler, event, delivery, error);
      return false;
    }
    try {
      await this.outbox.markDelivered(delivery.id, this.clock.now());
    } catch (error) {
      this.logger.error(
        `Delivery of ${event.eventType} ${event.eventId} to ${handler.name} ran but could not be marked delivered; it will run again`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return true;
  }

  private async recordFailure(
    handler: RegisteredHandler,
    event: DomainEvent,
    delivery: { readonly id: string; readonly attempts: number },
    error: unknown,
  ): Promise<void> {
    const attempt = `attempt ${delivery.attempts} of ${MAX_DELIVERY_ATTEMPTS}`;
    let outcome = 'its retry could not be recorded';
    try {
      const { retryAt } = await this.outbox.markFailedAttempt(
        delivery.id,
        delivery.attempts,
        this.clock.now(),
        describe(error),
      );
      outcome =
        retryAt === null
          ? 'no attempts left'
          : `retried at ${retryAt.toISOString()}`;
    } catch (markError) {
      this.logger.error(
        `Failure of ${handler.name} for ${event.eventType} ${event.eventId} could not be recorded`,
        markError instanceof Error ? markError.stack : String(markError),
      );
    }
    this.logger.error(
      `Handler ${handler.name} failed for ${event.eventType} ${event.eventId} (${attempt}; ${outcome})`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

/** The class and message of a failure, as `last_error` keeps it: redacted like the logs, and cut. */
function describe(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Error: ${String(error)}`;
  return redact(text).slice(0, MAX_ERROR_LENGTH);
}
