import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { toPayload } from '../src/platform/events/event-payload.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  eventMetadata,
  newId,
  type PermissionCode,
} from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const OCCURRED = new Date('2026-10-03T11:00:00.000Z');

/** The staff sees and retries the deliveries of domain events over HTTP (T-109 part b, API_SPEC.md §22, ADR-0150). */
describe('Event deliveries (e2e, T-109 part b)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    // Other suites leave their events; each test sees only its own.
    await prisma.storedDomainEvent.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'events.' } },
    });
    await app.close();
  });

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const operator = staff('events.manage');
  const http = () => request(app.getHttpServer());
  const list = (query = '', user = operator) =>
    http().get(`/v1/admin/event-deliveries${query}`).set(signedInAs(user));

  /** A stored `OrderPaid` with a failed delivery to `handler`, and a delivered one. */
  async function failed(handler = 'OrderEmails.onOrderPaid'): Promise<{
    eventId: string;
    failedId: string;
  }> {
    const event = { ...eventMetadata('OrderPaid', OCCURRED), orderId: newId() };
    const failedId = newId();
    await prisma.storedDomainEvent.create({
      data: {
        id: event.eventId,
        eventType: 'OrderPaid',
        payload: toPayload(event) as object,
        occurredAt: OCCURRED,
        deliveries: {
          create: [
            {
              id: failedId,
              handler,
              status: 'FAILED',
              attempts: 8,
              nextAttemptAt: OCCURRED,
              lastError: 'EmailDeliveryError: connection refused',
            },
            {
              id: newId(),
              handler: 'Other.onOrderPaid',
              status: 'DELIVERED',
              attempts: 1,
              nextAttemptAt: OCCURRED,
              deliveredAt: OCCURRED,
            },
          ],
        },
      },
    });
    return { eventId: event.eventId, failedId };
  }

  it('lists the failed deliveries by default, each with its event', async () => {
    const { eventId, failedId } = await failed();

    const { body } = await list().expect(200);

    expect(body).toEqual({
      data: [
        {
          id: failedId,
          eventId,
          eventType: 'OrderPaid',
          occurredAt: '2026-10-03T11:00:00.000Z',
          handler: 'OrderEmails.onOrderPaid',
          status: 'FAILED',
          attempts: 8,
          nextAttemptAt: '2026-10-03T11:00:00.000Z',
          lastError: 'EmailDeliveryError: connection refused',
          deliveredAt: null,
          event: {
            eventId,
            eventType: 'OrderPaid',
            occurredAt: '2026-10-03T11:00:00.000Z',
            orderId: expect.any(String),
          },
        },
      ],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    const delivered = await list(
      '?status=DELIVERED,FAILED&sort=nextAttemptAt',
    ).expect(200);
    expect(delivered.body.meta.totalItems).toBe(2);
  });

  it('lists the newest event first by default', async () => {
    const older = await failed('Older.onOrderPaid');
    await prisma.storedDomainEvent.update({
      where: { id: older.eventId },
      data: { occurredAt: new Date(OCCURRED.getTime() - 60_000) },
    });
    const newer = await failed('Newer.onOrderPaid');

    const { body } = await list().expect(200);

    expect(body.data.map(({ id }: { id: string }) => id)).toEqual([
      newer.failedId,
      older.failedId,
    ]);
  });

  it('retries a failed delivery once, and answers 409 after, and 404 for one that does not exist', async () => {
    const { failedId } = await failed();
    const retry = (id: string) =>
      http()
        .post(`/v1/admin/event-deliveries/${id}/retry`)
        .set(signedInAs(operator));

    const accepted = await retry(failedId).expect(202);
    const again = await retry(failedId).expect(409);
    const missing = await retry(newId()).expect(404);
    await retry('not-an-id').expect(404);

    expect(accepted.body).toEqual({});
    expect(again.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'PENDING',
    });
    expect(missing.body.type).toBe('/problems/not-found');
    expect(
      await prisma.eventDelivery.findUniqueOrThrow({ where: { id: failedId } }),
    ).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(
      await prisma.auditLog.findMany({
        where: { action: 'events.retry-delivery', resourceId: failedId },
        select: { actorId: true },
      }),
    ).toEqual([{ actorId: operator.id }]);
  });

  it('retries in bulk the failed deliveries of a handler', async () => {
    await failed('OrderEmails.onOrderPaid');
    await failed('OrderEmails.onOrderPaid');
    await failed('Shipments.onOrderPaid');

    const { body } = await http()
      .post('/v1/admin/event-deliveries/retry')
      .set(signedInAs(operator))
      .send({ handler: 'OrderEmails.onOrderPaid' })
      .expect(200);

    expect(body).toEqual({ retried: 2 });
    expect(
      (await list().expect(200)).body.data.map(
        ({ handler }: { handler: string }) => handler,
      ),
    ).toEqual(['Shipments.onOrderPaid']);
  });

  it('answers 400 to a status, a sort, an event type or a handler that cannot be', async () => {
    for (const query of [
      '?status=LOST',
      '?sort=handler',
      '?eventType=order-paid',
      '?handler=onOrderPaid',
    ]) {
      const { body } = await list(query).expect(400);
      expect(body.type).toBe('/problems/validation-error');
    }
    await http()
      .post('/v1/admin/event-deliveries/retry')
      .set(signedInAs(operator))
      .send({ eventType: 'order paid' })
      .expect(400);
  });

  it('is only for the staff with events.manage', async () => {
    const { failedId } = await failed();

    await http().get('/v1/admin/event-deliveries').expect(401);
    await list('', staff('audit.read')).expect(403);
    await http()
      .post(`/v1/admin/event-deliveries/${failedId}/retry`)
      .set(signedInAs(staff('orders.manage')))
      .expect(403);
    await http()
      .post('/v1/admin/event-deliveries/retry')
      .set(signedInAs(staff('orders.manage')))
      .send({})
      .expect(403);
  });
});
