import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { DomainEvent } from '../../shared-kernel/index.js';
import { ON_DOMAIN_EVENT } from './on-domain-event.decorator.js';

interface RegisteredHandler {
  /** `Class.method`, used in logs. */
  readonly name: string;
  readonly handle: (event: DomainEvent) => unknown;
}

/**
 * In-process event bus (ADR-0014, ADR-0098). Finds the `@OnDomainEvent` methods at startup and runs them in
 * the background: one after another, in publish order, each isolated from the failures of the others.
 * There are no retries; a failure is logged and the reconciliation jobs are the safety net.
 */
@Injectable()
export class DomainEventDispatcher
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(DomainEventDispatcher.name);
  private readonly handlers = new Map<string, RegisteredHandler[]>();
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
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

  /**
   * Runs the handlers of `events` in the background, within the current async context, so their logs keep
   * the correlation id of the request that published them.
   */
  dispatchInBackground(events: readonly DomainEvent[]): void {
    if (events.length === 0) return;
    const task = new Promise<void>((resolve) => {
      setImmediate(() => {
        void this.dispatch(events).finally(resolve);
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

  private register(eventType: string, handler: RegisteredHandler): void {
    this.handlers.set(eventType, [
      ...(this.handlers.get(eventType) ?? []),
      handler,
    ]);
  }

  private async dispatch(events: readonly DomainEvent[]): Promise<void> {
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
}
