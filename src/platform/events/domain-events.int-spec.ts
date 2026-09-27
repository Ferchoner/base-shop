import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { jest } from '@jest/globals';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { CLS_ID, ClsModule, ClsService } from 'nestjs-cls';
import {
  type DomainEvent,
  DomainEventPublisher,
  eventMetadata,
  TransactionManager,
} from '../../shared-kernel/index.js';
import { validateEnvironment } from '../config/environment.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { PrismaTransactionAdapter } from '../persistence/transactional-plugin.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { EventsModule } from './events.module.js';
import { OnDomainEvent } from './on-domain-event.decorator.js';

const NAME_PREFIX = 'event-test-';

interface BrandCreated extends DomainEvent<'BrandCreated'> {
  readonly name: string;
}

interface SlowWorkRequested extends DomainEvent<'SlowWorkRequested'> {
  readonly name: string;
}

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
      EventsModule,
    ],
    providers: [ProbeHandlers],
  }).compile();
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

  afterEach(async () => {
    await dispatcher.whenIdle();
    handlers.received.length = 0;
    handlers.failNext = false;
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
      `Handler ProbeHandlers.first failed for BrandCreated ${event.eventId}`,
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
});
