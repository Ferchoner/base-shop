import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { jest } from '@jest/globals';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { CLS_ID, ClsModule, ClsService } from 'nestjs-cls';
import {
  Clock,
  type DomainEvent,
  DomainEventPublisher,
  eventMetadata,
  Money,
  TransactionManager,
} from '../../shared-kernel/index.js';
import { ClockModule } from '../clock/clock.module.js';
import { validateEnvironment } from '../config/environment.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { PrismaTransactionAdapter } from '../persistence/transactional-plugin.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { EventOutbox } from './event-outbox.js';
import { MAX_DELIVERY_ATTEMPTS } from './event-retries.js';
import { EventsModule } from './events.module.js';
import { OnDomainEvent } from './on-domain-event.decorator.js';

const NAME_PREFIX = 'event-test-';

interface BrandCreated extends DomainEvent<'BrandCreated'> {
  readonly name: string;
}

interface SlowWorkRequested extends DomainEvent<'SlowWorkRequested'> {
  readonly name: string;
}

/** An event with the values a stored payload must bring back: dates, money and nested lists. */
interface ParcelSent extends DomainEvent<'ParcelSent'> {
  readonly sentAt: Date;
  readonly cost: Money;
  readonly stops: readonly { readonly at: Date; readonly code: string }[];
}

/** The clock of the tests, moved by hand. */
const START = Date.parse('2026-10-03T12:00:00.000Z');
let now = START;

function brandCreated(name: string): BrandCreated {
  return { ...eventMetadata('BrandCreated', new Date()), name };
}

interface Received {
  readonly handler: string;
  readonly event: DomainEvent;
  /** Brands with the test prefix visible to the handler, read outside any transaction. */
  readonly committedBrands: number;
  readonly correlationId: string | undefined;
}

/** Test-only handlers standing in for inbound adapters of other contexts. */
@Injectable()
class ProbeHandlers {
  readonly received: Received[] = [];
  failNext = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly transactions: TransactionManager,
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
    private readonly publisher: DomainEventPublisher,
  ) {}

  @OnDomainEvent('BrandCreated')
  async first(event: BrandCreated): Promise<void> {
    await this.record('first', event);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('first handler failed');
    }
  }

  @OnDomainEvent('BrandCreated')
  async second(event: BrandCreated): Promise<void> {
    await this.record('second', event);
  }

  /** A handler that runs its own use case, which publishes another event (a chain). */
  @OnDomainEvent('ChainStarted')
  async startChain(event: DomainEvent<'ChainStarted'>): Promise<void> {
    await this.record('startChain', event);
    await this.transactions.run(async () => {
      await insertBrand(this.txHost, 'chained');
      this.publisher.publish(brandCreated('chained'));
    });
  }

  @OnDomainEvent('ParcelSent')
  async parcel(event: ParcelSent): Promise<void> {
    await this.record('parcel', event);
    if (this.failNext) {
      this.failNext = false;
      throw new Error(this.failure);
    }
  }

  /** What the parcel handler fails with. */
  failure = 'parcel handler failed for ana@example.com';

  @OnDomainEvent('SlowWorkRequested')
  async slow(event: SlowWorkRequested): Promise<void> {
    await sleep(200);
    await this.record('slow', event);
  }

  private async record(handler: string, event: DomainEvent): Promise<void> {
    const committedBrands = await this.prisma.brand.count({
      where: { name: { startsWith: NAME_PREFIX } },
    });
    const correlationId = this.cls.isActive() ? this.cls.getId() : undefined;
    this.received.push({ handler, event, committedBrands, correlationId });
  }
}

function insertBrand(
  txHost: TransactionHost<PrismaTransactionAdapter>,
  name: string,
) {
  return txHost.tx.brand.create({
    data: {
      id: randomUUID(),
      name: `${NAME_PREFIX}${name}`,
      slug: `${NAME_PREFIX}${name}`,
      status: 'ACTIVE',
    },
  });
}

async function createModule(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnvironment,
      }),
      ClsModule.forRoot({ global: true }),
      PersistenceModule,
      ClockModule,
      EventsModule,
    ],
    providers: [ProbeHandlers],
  })
    .overrideProvider(Clock)
    .useValue({ now: () => new Date(now) })
    .compile();
  await moduleRef.init();
  return moduleRef;
}

/**
 * Domain events (T-116, ADR-0098): dispatched in the background after the commit, dropped on rollback,
 * with each handler isolated from the failures of the others.
 */
describe('Domain events (T-116)', () => {
  let moduleRef: TestingModule;
  let transactions: TransactionManager;
  let publisher: DomainEventPublisher;
  let dispatcher: DomainEventDispatcher;
  let handlers: ProbeHandlers;
  let txHost: TransactionHost<PrismaTransactionAdapter>;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await createModule();
    transactions = moduleRef.get(TransactionManager);
    publisher = moduleRef.get(DomainEventPublisher);
    dispatcher = moduleRef.get(DomainEventDispatcher);
    handlers = moduleRef.get(ProbeHandlers);
    txHost = moduleRef.get(TransactionHost);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    now = START;
    // Other suites leave their events; each test sees only its own.
    await prisma.storedDomainEvent.deleteMany();
  });

  afterEach(async () => {
    await dispatcher.whenIdle();
    handlers.received.length = 0;
    handlers.failNext = false;
    handlers.failure = 'parcel handler failed for ana@example.com';
    jest.restoreAllMocks();
    await prisma.brand.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
  });

  it('dispatches after the commit, in the background, to every handler in order', async () => {
    await transactions.run(async () => {
      await insertBrand(txHost, 'a');
      publisher.publish(brandCreated('a'));
    });

    // `run` has returned, but handlers only start in the background.
    expect(handlers.received).toHaveLength(0);

    await dispatcher.whenIdle();
    expect(handlers.received.map((entry) => entry.handler)).toEqual([
      'first',
      'second',
    ]);
    // The handler already sees the committed row.
    expect(handlers.received[0].committedBrands).toBe(1);
  });

  it('drops the events of a transaction that rolls back', async () => {
    await expect(
      transactions.run(async () => {
        await insertBrand(txHost, 'a');
        publisher.publish(brandCreated('a'));
        throw new Error('use case failed');
      }),
    ).rejects.toThrow('use case failed');

    await dispatcher.whenIdle();
    expect(handlers.received).toHaveLength(0);
  });

  it('dispatches the events of nested runs once, after the outer commit, in publish order', async () => {
    await transactions.run(async () => {
      publisher.publish(brandCreated('outer-before'));
      await transactions.run(async () => {
        await insertBrand(txHost, 'inner');
        publisher.publish(brandCreated('inner'));
      });
      publisher.publish(brandCreated('outer-after'));
    });

    await dispatcher.whenIdle();
    const names = handlers.received
      .filter((entry) => entry.handler === 'first')
      .map((entry) => (entry.event as BrandCreated).name);
    expect(names).toEqual(['outer-before', 'inner', 'outer-after']);
  });

  it('drops the events of an inner run when the outer transaction rolls back', async () => {
    await expect(
      transactions.run(async () => {
        await transactions.run(async () => {
          publisher.publish(brandCreated('inner'));
        });
        throw new Error('outer failed');
      }),
    ).rejects.toThrow('outer failed');

    await dispatcher.whenIdle();
    expect(handlers.received).toHaveLength(0);
  });

  it('drops the events of an undone nested step, and keeps the others in publish order (ADR-0133)', async () => {
    await transactions.run(async () => {
      publisher.publish(brandCreated('before'));
      await expect(
        transactions.runNested(async () => {
          publisher.publish(brandCreated('undone'));
          throw new Error('step failed');
        }),
      ).rejects.toThrow('step failed');
      await transactions.runNested(async () => {
        publisher.publish(brandCreated('kept'));
      });
      publisher.publish(brandCreated('after'));
    });

    await dispatcher.whenIdle();
    const names = handlers.received
      .filter((entry) => entry.handler === 'first')
      .map((entry) => (entry.event as BrandCreated).name);
    expect(names).toEqual(['before', 'kept', 'after']);
  });

  it('dispatches right away, in the background, outside a transaction', async () => {
    publisher.publish(brandCreated('outside'));

    await dispatcher.whenIdle();
    expect(handlers.received).toHaveLength(2);
  });

  it('logs a failing handler and still runs the others', async () => {
    const errors: unknown[][] = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
    handlers.failNext = true;
    const event = brandCreated('a');

    await transactions.run(async () => {
      publisher.publish(event);
    });
    await dispatcher.whenIdle();

    expect(handlers.received.map((entry) => entry.handler)).toEqual([
      'first',
      'second',
    ]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0])).toBe(
      `Handler ProbeHandlers.first failed for BrandCreated ${event.eventId} (attempt 1 of 8; retried at 2026-10-03T12:01:00.000Z)`,
    );
    expect(String(errors[0][1])).toContain('first handler failed');
  });

  it('runs chains: a handler whose use case publishes another event', async () => {
    publisher.publish(eventMetadata('ChainStarted', new Date()));

    await dispatcher.whenIdle();
    expect(handlers.received.map((entry) => entry.handler)).toEqual([
      'startChain',
      'first',
      'second',
    ]);
    expect(handlers.received[1].committedBrands).toBe(1);
  });

  it('keeps the correlation id of the request that published the event', async () => {
    const cls = moduleRef.get(ClsService);
    await cls.run(async () => {
      cls.set(CLS_ID, 'request-correlation-id');
      await transactions.run(async () => {
        publisher.publish(brandCreated('a'));
      });
    });

    await dispatcher.whenIdle();
    expect(handlers.received[0].correlationId).toBe('request-correlation-id');
  });

  it('lets in-flight handlers finish before the application closes', async () => {
    const otherModule = await createModule();
    const otherHandlers = otherModule.get(ProbeHandlers);
    const slowWork: SlowWorkRequested = {
      ...eventMetadata('SlowWorkRequested', new Date()),
      name: 'slow',
    };
    otherModule.get(DomainEventPublisher).publish(slowWork);

    await otherModule.close();

    expect(otherHandlers.received.map((entry) => entry.handler)).toEqual([
      'slow',
    ]);
  });
  describe('the outbox (ADR-0150)', () => {
    const parcelSent = (): ParcelSent => ({
      ...eventMetadata('ParcelSent', new Date('2026-10-03T11:00:00.000Z')),
      sentAt: new Date('2026-10-03T10:30:00.000Z'),
      cost: Money.of(9_900, 'MXN'),
      stops: [{ at: new Date('2026-10-03T10:45:00.000Z'), code: 'MLM' }],
    });

    const deliveries = () =>
      prisma.eventDelivery.findMany({
        orderBy: { handler: 'asc' },
        select: {
          handler: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          lockedUntil: true,
          lastError: true,
          deliveredAt: true,
        },
      });

    /** Stores events as `publish` does, inside a transaction, without dispatching them: an API that stopped. */
    async function storedOnly(...events: DomainEvent[]): Promise<void> {
      await transactions.run(() =>
        moduleRef.get(EventOutbox).save(
          events.map((event) => ({
            event,
            handlers: dispatcher.handlerNames(event.eventType),
          })),
          new Date(now),
        ),
      );
    }

    it('stores each event with the change and one delivery per handler, and marks them delivered after the commit', async () => {
      const event = brandCreated('stored');

      await transactions.run(async () => {
        await insertBrand(txHost, 'stored');
        publisher.publish(event);
      });
      await dispatcher.whenIdle();

      expect(
        await prisma.storedDomainEvent.findUniqueOrThrow({
          where: { id: event.eventId },
        }),
      ).toMatchObject({
        eventType: 'BrandCreated',
        occurredAt: event.occurredAt,
        payload: {
          eventId: event.eventId,
          eventType: 'BrandCreated',
          occurredAt: { $date: event.occurredAt.toISOString() },
          name: 'stored',
        },
      });
      expect(await deliveries()).toEqual([
        {
          handler: 'ProbeHandlers.first',
          status: 'DELIVERED',
          attempts: 1,
          nextAttemptAt: new Date(START + 60_000),
          lockedUntil: null,
          lastError: null,
          deliveredAt: new Date(START),
        },
        expect.objectContaining({
          handler: 'ProbeHandlers.second',
          status: 'DELIVERED',
          attempts: 1,
        }),
      ]);
    });

    it('stores nothing of a transaction that rolls back, nor of an undone nested step', async () => {
      await expect(
        transactions.run(async () => {
          publisher.publish(brandCreated('rolled-back'));
          throw new Error('use case failed');
        }),
      ).rejects.toThrow('use case failed');
      const kept = brandCreated('kept');
      await transactions.run(async () => {
        await expect(
          transactions.runNested(async () => {
            publisher.publish(brandCreated('undone'));
            throw new Error('step failed');
          }),
        ).rejects.toThrow('step failed');
        publisher.publish(kept);
      });
      await dispatcher.whenIdle();

      expect(
        await prisma.storedDomainEvent.findMany({ select: { id: true } }),
      ).toEqual([{ id: kept.eventId }]);
    });

    it('stores an event published outside a transaction too', async () => {
      const event = brandCreated('outside');

      publisher.publish(event);
      await dispatcher.whenIdle();

      expect((await deliveries()).map(({ status }) => status)).toEqual([
        'DELIVERED',
        'DELIVERED',
      ]);
    });

    it('never stores a volatile event, nor an event without handlers', async () => {
      await transactions.run(async () => {
        publisher.publishVolatile(brandCreated('volatile'));
        publisher.publish(eventMetadata('NobodyListens', new Date()));
      });
      await dispatcher.whenIdle();

      expect(handlers.received.map(({ handler }) => handler)).toEqual([
        'first',
        'second',
      ]);
      expect(await prisma.storedDomainEvent.count()).toBe(0);
    });

    it('delivers stored and volatile events published together in publish order, each its own way', async () => {
      const stored = brandCreated('stored');
      const volatile = brandCreated('volatile');
      const later = brandCreated('later');

      await transactions.run(async () => {
        publisher.publish(stored);
        publisher.publishVolatile(volatile);
        publisher.publish(later);
      });
      await dispatcher.whenIdle();

      expect(
        handlers.received
          .filter(({ handler }) => handler === 'first')
          .map(({ event }) => (event as BrandCreated).name),
      ).toEqual(['stored', 'volatile', 'later']);
      expect(
        await prisma.storedDomainEvent.findMany({
          orderBy: { occurredAt: 'asc' },
          select: { id: true },
        }),
      ).toEqual(
        expect.arrayContaining([{ id: stored.eventId }, { id: later.eventId }]),
      );
      expect(await prisma.storedDomainEvent.count()).toBe(2);
      expect((await deliveries()).map(({ status }) => status)).toEqual([
        'DELIVERED',
        'DELIVERED',
        'DELIVERED',
        'DELIVERED',
      ]);
    });

    it('hands the handler the event with its dates as dates, also after the commit, as a retry would read it', async () => {
      const event = parcelSent();

      await transactions.run(async () => {
        publisher.publish(event);
      });
      await dispatcher.whenIdle();

      const received = handlers.received[0].event as ParcelSent;
      expect(received).toEqual({
        eventId: event.eventId,
        eventType: 'ParcelSent',
        occurredAt: event.occurredAt,
        sentAt: event.sentAt,
        cost: { amount: 9_900, currency: 'MXN' },
        stops: [{ at: event.stops[0].at, code: 'MLM' }],
      });
      expect(received.sentAt).toBeInstanceOf(Date);
      expect(received.stops[0].at).toBeInstanceOf(Date);
      // Money as its JSON, the same as the retry job would read it, never the instance published.
      expect(received.cost).toStrictEqual({ amount: 9_900, currency: 'MXN' });
    });

    it('keeps a failed delivery for a retry a minute later, with its error redacted, and delivers the other handlers', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      handlers.failNext = true;

      await transactions.run(async () => {
        publisher.publish(parcelSent());
        publisher.publish(brandCreated('other'));
      });
      await dispatcher.whenIdle();

      expect(await deliveries()).toEqual([
        expect.objectContaining({
          handler: 'ProbeHandlers.first',
          status: 'DELIVERED',
        }),
        {
          handler: 'ProbeHandlers.parcel',
          status: 'PENDING',
          attempts: 1,
          nextAttemptAt: new Date(START + 60_000),
          lockedUntil: null,
          lastError: 'Error: parcel handler failed for [redacted]',
          deliveredAt: null,
        },
        expect.objectContaining({
          handler: 'ProbeHandlers.second',
          status: 'DELIVERED',
        }),
      ]);
    });

    it('retries a due delivery only once its time comes, and then delivers it', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      handlers.failNext = true;
      const event = parcelSent();
      await transactions.run(async () => {
        publisher.publish(event);
      });
      await dispatcher.whenIdle();
      handlers.received.length = 0;

      now = START + 59_999;
      expect(await dispatcher.deliverDue()).toEqual({
        delivered: 0,
        failed: 0,
        abandoned: 0,
      });
      now = START + 60_000;
      expect(await dispatcher.deliverDue()).toEqual({
        delivered: 1,
        failed: 0,
        abandoned: 0,
      });

      expect(handlers.received.map(({ handler }) => handler)).toEqual([
        'parcel',
      ]);
      expect((handlers.received[0].event as ParcelSent).sentAt).toEqual(
        event.sentAt,
      );
      expect(await deliveries()).toEqual([
        expect.objectContaining({
          status: 'DELIVERED',
          attempts: 2,
          lastError: null,
          deliveredAt: new Date(START + 60_000),
        }),
      ]);
    });

    it('delivers the events of an API that stopped after the commit, oldest first, a minute later', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const older = brandCreated('older');
      const newer: BrandCreated = {
        ...eventMetadata(
          'BrandCreated',
          new Date(older.occurredAt.getTime() + 1),
        ),
        name: 'newer',
      };
      await storedOnly(newer, older);

      expect((await dispatcher.deliverDue()).delivered).toBe(0);
      now = START + 60_000;
      expect((await dispatcher.deliverDue()).delivered).toBe(4);

      expect(
        handlers.received.map(
          ({ handler, event }) => `${handler} ${(event as BrandCreated).name}`,
        ),
      ).toEqual(['first older', 'second older', 'first newer', 'second newer']);
    });

    it('fails a delivery for good after its last attempt', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      await storedOnly(parcelSent());
      await prisma.eventDelivery.updateMany({
        data: { attempts: MAX_DELIVERY_ATTEMPTS - 1 },
      });
      handlers.failNext = true;
      now = START + 60_000;

      expect((await dispatcher.deliverDue()).failed).toBe(1);

      expect(await deliveries()).toEqual([
        expect.objectContaining({
          status: 'FAILED',
          attempts: MAX_DELIVERY_ATTEMPTS,
          lockedUntil: null,
          lastError: 'Error: parcel handler failed for [redacted]',
        }),
      ]);
      now = START + 86_400_000;
      expect((await dispatcher.deliverDue()).failed).toBe(0);
    });

    it('takes again a delivery whose attempt never finished, once its lease runs out, and fails it if it was the last', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      await storedOnly(parcelSent(), brandCreated('held'));
      const held = { lockedUntil: new Date(START + 5 * 60_000) };
      await prisma.eventDelivery.updateMany({
        where: { handler: 'ProbeHandlers.parcel' },
        data: { attempts: MAX_DELIVERY_ATTEMPTS, ...held },
      });
      await prisma.eventDelivery.updateMany({
        where: { handler: { not: 'ProbeHandlers.parcel' } },
        data: { attempts: 1, ...held },
      });
      now = START + 60_000;

      expect(await dispatcher.deliverDue()).toEqual({
        delivered: 0,
        failed: 0,
        abandoned: 0,
      });
      now = START + 5 * 60_000;
      expect(await dispatcher.deliverDue()).toEqual({
        delivered: 2,
        failed: 0,
        abandoned: 1,
      });

      expect(await deliveries()).toEqual([
        expect.objectContaining({ status: 'DELIVERED', attempts: 2 }),
        expect.objectContaining({
          handler: 'ProbeHandlers.parcel',
          status: 'FAILED',
          lastError: 'The last attempt did not finish',
        }),
        expect.objectContaining({ status: 'DELIVERED', attempts: 2 }),
      ]);
    });

    it('fails for good the delivery of a handler that is no longer registered', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      await storedOnly(brandCreated('renamed'));
      await prisma.eventDelivery.updateMany({
        where: { handler: 'ProbeHandlers.second' },
        data: { handler: 'RemovedHandlers.second' },
      });
      now = START + 60_000;

      expect(await dispatcher.deliverDue()).toEqual({
        delivered: 1,
        failed: 1,
        abandoned: 0,
      });
      expect(await deliveries()).toEqual([
        expect.objectContaining({ status: 'DELIVERED' }),
        expect.objectContaining({
          handler: 'RemovedHandlers.second',
          status: 'FAILED',
          lastError: 'Handler RemovedHandlers.second is not registered',
        }),
      ]);
    });

    it('gives each due delivery to one run only when two run at once', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      await storedOnly(
        brandCreated('one'),
        brandCreated('two'),
        brandCreated('three'),
      );
      now = START + 60_000;

      const runs = await Promise.all([
        dispatcher.deliverDue(),
        dispatcher.deliverDue(),
      ]);

      expect(runs[0].delivered + runs[1].delivered).toBe(6);
      expect(handlers.received).toHaveLength(6);
    });

    it('rolls the change back when its events cannot be stored', async () => {
      const event = brandCreated('twice');

      await expect(
        transactions.run(async () => {
          await insertBrand(txHost, 'twice');
          publisher.publish(event, event);
        }),
      ).rejects.toThrow();
      await dispatcher.whenIdle();

      expect(
        await prisma.brand.count({
          where: { name: { startsWith: NAME_PREFIX } },
        }),
      ).toBe(0);
      expect(handlers.received).toHaveLength(0);
    });

    it('runs, after the commit, no delivery already settled', async () => {
      const event = brandCreated('settled');
      await storedOnly(event);
      await prisma.eventDelivery.updateMany({
        where: { handler: 'ProbeHandlers.first' },
        data: { status: 'DELIVERED', deliveredAt: new Date(START) },
      });

      await dispatcher.deliver([event]);

      expect(handlers.received.map(({ handler }) => handler)).toEqual([
        'second',
      ]);
    });

    it('takes a delivery only while it is pending, free and has attempts left', async () => {
      const outbox = moduleRef.get(EventOutbox);
      const free = brandCreated('free');
      const held = brandCreated('held');
      const settled = brandCreated('settled');
      const spent = brandCreated('spent');
      await storedOnly(free, held, settled, spent);
      const of = (event: DomainEvent) => ({
        eventId: event.eventId,
        handler: 'ProbeHandlers.first',
      });
      await prisma.eventDelivery.updateMany({
        where: of(held),
        data: { lockedUntil: new Date(START + 1) },
      });
      await prisma.eventDelivery.updateMany({
        where: of(settled),
        data: { status: 'FAILED' },
      });
      await prisma.eventDelivery.updateMany({
        where: of(spent),
        data: { attempts: MAX_DELIVERY_ATTEMPTS },
      });
      const claim = (event: DomainEvent) =>
        outbox.claim(event.eventId, 'ProbeHandlers.first', new Date(START));

      expect(await claim(free)).toEqual({
        id: expect.any(String),
        attempts: 1,
      });
      expect(
        await prisma.eventDelivery.findFirstOrThrow({ where: of(free) }),
      ).toMatchObject({ lockedUntil: new Date(START + 5 * 60_000) });
      expect(await claim(free)).toBeNull();
      expect(await claim(held)).toBeNull();
      expect(await claim(settled)).toBeNull();
      expect(await claim(spent)).toBeNull();
      expect(
        await outbox.claim(
          held.eventId,
          'ProbeHandlers.first',
          new Date(START + 1),
        ),
      ).toEqual({ id: expect.any(String), attempts: 1 });
    });

    it('keeps at most 500 characters of an error', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      handlers.failNext = true;
      handlers.failure = 'x'.repeat(600);

      await transactions.run(async () => {
        publisher.publish(parcelSent());
      });
      await dispatcher.whenIdle();

      const [delivery] = await deliveries();
      expect(delivery.lastError).toBe(`Error: ${'x'.repeat(493)}`);
    });

    it('leaves to the retry job nothing the dispatch after the commit still holds', async () => {
      await storedOnly(brandCreated('held'));
      await prisma.eventDelivery.updateMany({
        data: { lockedUntil: new Date(START + 5 * 60_000) },
      });
      now = START + 60_000;

      expect((await dispatcher.deliverDue()).delivered).toBe(0);
      expect(handlers.received).toHaveLength(0);
    });
  });
});
