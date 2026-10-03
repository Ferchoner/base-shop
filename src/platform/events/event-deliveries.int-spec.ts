import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AuditModule } from '../../modules/audit/index.js';
import {
  Clock,
  type DomainEvent,
  eventMetadata,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
} from '../../shared-kernel/index.js';
import { ClockModule } from '../clock/clock.module.js';
import { validateEnvironment } from '../config/environment.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { toPayload } from './event-payload.js';
import { DeliveredEventCleanup } from './delivered-event-cleanup.js';
import { EventDeliveries } from './event-deliveries.js';
import { EventDeliveriesModule } from './event-deliveries.module.js';
import { EventsModule } from './events.module.js';

const START = Date.parse('2026-10-03T12:00:00.000Z');
const DAY = 86_400_000;
const AUDITED = ['events.retry-delivery', 'events.retry-deliveries'];

/** The deliveries of domain events for the staff and the daily cleanup, against PostgreSQL 18 (T-109 part b, ADR-0150). */
describe('Event deliveries for the staff (T-109 part b)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let deliveries: EventDeliveries;
  let now = START;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
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
        AuditModule,
        EventDeliveriesModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(now) })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    deliveries = moduleRef.get(EventDeliveries);
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
    jest.restoreAllMocks();
    await prisma.auditLog.deleteMany({ where: { action: { in: AUDITED } } });
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  /** A stored event of `eventType`, `minutesAgo` minutes before START, with one delivery per entry of `handlers`. */
  async function stored(
    eventType: string,
    minutesAgo: number,
    handlers: Record<
      string,
      {
        status: 'PENDING' | 'DELIVERED' | 'FAILED';
        deliveredAt?: Date;
        attempts?: number;
      }
    >,
  ): Promise<{ event: DomainEvent; ids: Record<string, string> }> {
    const event = {
      ...eventMetadata(eventType, new Date(START - minutesAgo * 60_000)),
      orderId: newId(),
    };
    await prisma.storedDomainEvent.create({
      data: {
        id: event.eventId,
        eventType,
        payload: toPayload(event) as object,
        occurredAt: event.occurredAt,
      },
    });
    const ids: Record<string, string> = {};
    for (const [handler, delivery] of Object.entries(handlers)) {
      ids[handler] = newId();
      await prisma.eventDelivery.create({
        data: {
          id: ids[handler],
          eventId: event.eventId,
          handler,
          status: delivery.status,
          attempts: delivery.attempts ?? 8,
          nextAttemptAt: new Date(START - minutesAgo * 60_000 + 60_000),
          lastError: delivery.status === 'FAILED' ? 'Error: boom' : null,
          deliveredAt: delivery.deliveredAt ?? null,
        },
      });
    }
    return { event, ids };
  }

  const page = { page: 1, pageSize: 20 };
  const newestFirst = [{ field: 'occurredAt', direction: 'desc' }] as const;

  describe('listing', () => {
    it('lists the deliveries of a status, newest event first, each with its event as the handler gets it', async () => {
      const older = await stored('PaymentCaptured', 30, {
        'PaymentCapturedHandler.onPaymentCaptured': { status: 'FAILED' },
      });
      const newer = await stored('OrderPaid', 10, {
        'OrderEmails.onOrderPaid': { status: 'FAILED' },
        'Other.onOrderPaid': {
          status: 'DELIVERED',
          deliveredAt: new Date(START),
        },
      });

      const failed = await run(() =>
        deliveries.list({ status: ['FAILED'] }, newestFirst, page),
      );

      expect(failed.totalItems).toBe(2);
      expect(failed.items).toEqual([
        {
          id: newer.ids['OrderEmails.onOrderPaid'],
          eventId: newer.event.eventId,
          eventType: 'OrderPaid',
          occurredAt: newer.event.occurredAt,
          handler: 'OrderEmails.onOrderPaid',
          status: 'FAILED',
          attempts: 8,
          nextAttemptAt: new Date(START - 10 * 60_000 + 60_000),
          lastError: 'Error: boom',
          deliveredAt: null,
          event: newer.event,
        },
        expect.objectContaining({
          id: older.ids['PaymentCapturedHandler.onPaymentCaptured'],
        }),
      ]);
      expect(failed.items[0].event.occurredAt).toBeInstanceOf(Date);
    });

    it('filters by each of status, event type and handler on its own, and sorts by the next attempt', async () => {
      const paid = await stored('OrderPaid', 30, {
        'OrderEmails.onOrderPaid': { status: 'FAILED' },
        'Shipments.onOrderPaid': { status: 'PENDING', attempts: 2 },
      });
      const placed = await stored('OrderPlaced', 10, {
        'OrderEmails.onOrderPlaced': { status: 'FAILED' },
      });
      const idsOf = async (filter: Parameters<EventDeliveries['list']>[0]) =>
        (await run(() => deliveries.list(filter, newestFirst, page))).items.map(
          ({ id }) => id,
        );

      expect(await idsOf({ status: ['PENDING'] })).toEqual([
        paid.ids['Shipments.onOrderPaid'],
      ]);
      expect(await idsOf({ eventType: 'OrderPaid' })).toEqual(
        [
          paid.ids['OrderEmails.onOrderPaid'],
          paid.ids['Shipments.onOrderPaid'],
        ].sort(),
      );
      expect(await idsOf({ handler: 'OrderEmails.onOrderPlaced' })).toEqual([
        placed.ids['OrderEmails.onOrderPlaced'],
      ]);
      expect(
        (
          await run(() =>
            deliveries.list(
              { status: ['FAILED'] },
              [{ field: 'nextAttemptAt', direction: 'asc' }],
              { page: 1, pageSize: 1 },
            ),
          )
        ).items.map(({ id }) => id),
      ).toEqual([paid.ids['OrderEmails.onOrderPaid']]);
    });
  });

  describe('retrying', () => {
    it('puts a failed delivery back to pending, due now, with its 8 attempts and its last error, and audits it', async () => {
      const { ids } = await stored('OrderPaid', 30, {
        'Gone.onOrderPaid': { status: 'FAILED' },
      });
      const id = ids['Gone.onOrderPaid'];
      now = START + 60_000;

      await run(() => deliveries.retry(id));

      expect(
        await prisma.eventDelivery.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(START + 60_000),
        lockedUntil: null,
        lastError: 'Error: boom',
      });
      expect(
        await prisma.auditLog.findMany({
          where: { action: 'events.retry-delivery' },
          select: { resourceType: true, resourceId: true, changes: true },
        }),
      ).toEqual([
        {
          resourceType: 'event-delivery',
          resourceId: id,
          changes: { status: { from: 'FAILED', to: 'PENDING' } },
        },
      ]);
    });

    it('answers 404 for a delivery that does not exist, and 409 for one that did not fail', async () => {
      const { ids } = await stored('OrderPaid', 30, {
        'A.onOrderPaid': { status: 'PENDING', attempts: 1 },
        'B.onOrderPaid': { status: 'DELIVERED', deliveredAt: new Date(START) },
      });

      await expect(run(() => deliveries.retry(newId()))).rejects.toThrow(
        NotFoundError,
      );
      for (const [handler, status] of [
        ['A.onOrderPaid', 'PENDING'],
        ['B.onOrderPaid', 'DELIVERED'],
      ]) {
        await expect(
          run(() => deliveries.retry(ids[handler])),
        ).rejects.toMatchObject({
          constructor: InvalidStateTransitionError,
          details: { currentStatus: status },
        });
      }
      expect(
        await prisma.auditLog.count({ where: { action: { in: AUDITED } } }),
      ).toBe(0);
    });

    it('retries every failed delivery of an event type, of a handler, or all, and audits it once with the filter', async () => {
      await stored('OrderPaid', 30, {
        'OrderEmails.onOrderPaid': { status: 'FAILED' },
        'Shipments.onOrderPaid': { status: 'PENDING', attempts: 2 },
      });
      await stored('OrderPlaced', 20, {
        'OrderEmails.onOrderPlaced': { status: 'FAILED' },
      });
      await stored('OrderPlaced', 10, {
        'OrderEmails.onOrderPlaced': { status: 'FAILED' },
      });

      expect(
        await run(() => deliveries.retryAll({ eventType: 'OrderPlaced' })),
      ).toBe(2);
      expect(
        await run(() =>
          deliveries.retryAll({ handler: 'OrderEmails.onOrderPaid' }),
        ),
      ).toBe(1);
      expect(await run(() => deliveries.retryAll({}))).toBe(0);

      expect(
        await prisma.eventDelivery.count({ where: { status: 'FAILED' } }),
      ).toBe(0);
      expect(
        await prisma.auditLog.findMany({
          where: { action: 'events.retry-deliveries' },
          orderBy: { occurredAt: 'asc' },
          select: { changes: true },
        }),
      ).toEqual([
        {
          changes: {
            status: { from: 'FAILED', to: 'PENDING' },
            retried: { from: 0, to: 2 },
            eventType: { from: null, to: 'OrderPlaced' },
          },
        },
        {
          changes: {
            status: { from: 'FAILED', to: 'PENDING' },
            retried: { from: 0, to: 1 },
            handler: { from: null, to: 'OrderEmails.onOrderPaid' },
          },
        },
      ]);
    });
  });

  describe('the daily cleanup (ADR-0144)', () => {
    it('deletes the events all of whose deliveries succeeded 7 days before, and keeps the rest', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      const delivered = (ago: number) => ({
        status: 'DELIVERED' as const,
        deliveredAt: new Date(START - ago),
      });
      const old = await stored('OrderPaid', 20_000, {
        'A.onOrderPaid': delivered(8 * DAY),
        'B.onOrderPaid': delivered(7 * DAY + 1),
      });
      const atTheCut = await stored('OrderPaid', 20_000, {
        'A.onOrderPaid': delivered(7 * DAY),
      });
      const withFailure = await stored('OrderPaid', 20_000, {
        'A.onOrderPaid': delivered(8 * DAY),
        'B.onOrderPaid': { status: 'FAILED' },
      });
      const withPending = await stored('OrderPaid', 20_000, {
        'A.onOrderPaid': { status: 'PENDING', attempts: 1 },
      });

      expect(await moduleRef.get(DeliveredEventCleanup).run()).toBe(1);

      expect(
        (await prisma.storedDomainEvent.findMany({ select: { id: true } }))
          .map(({ id }) => id)
          .sort(),
      ).toEqual(
        [atTheCut, withFailure, withPending]
          .map(({ event }) => event.eventId)
          .sort(),
      );
      expect(
        await prisma.eventDelivery.count({
          where: { eventId: old.event.eventId },
        }),
      ).toBe(0);
    });
  });
});
