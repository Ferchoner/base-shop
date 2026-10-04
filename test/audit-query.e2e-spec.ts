import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId, type PermissionCode } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The staff's reading of the audit trail over HTTP (T-220, UC-AUD-02, ADR-0037, ADR-0146). */
describe('Audit query (e2e, T-220)', () => {
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
    await prisma.auditLog.deleteMany();
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const auditor = staff('audit.read');

  const audit = (query = '', user = auditor) =>
    http().get(`/v1/admin/audit${query}`).set(signedInAs(user));

  /** Records at these times, each with its own action, newest last. */
  async function recorded(
    ...rows: { at: string; action?: string; result?: 'SUCCESS' | 'DENIED' }[]
  ): Promise<string[]> {
    const ids = rows.map(() => newId());
    await prisma.auditLog.createMany({
      data: rows.map((candidate, index) => ({
        id: ids[index],
        occurredAt: new Date(candidate.at),
        actorType: 'SYSTEM' as const,
        action: candidate.action ?? 'orders.expire',
        result: candidate.result ?? ('SUCCESS' as const),
      })),
    });
    return ids;
  }

  it('shows a change of the staff with who, where, what changed and why, never a personal value', async () => {
    const manager = staff('customers.manage');
    const customerId = newId();
    await prisma.user.create({
      data: {
        id: customerId,
        type: 'CUSTOMER',
        email: `${customerId}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
      },
    });
    const suspension = await http()
      .post(`/v1/admin/identity/customers/${customerId}/suspend`)
      .set(signedInAs(manager))
      .set('User-Agent', 'base-shop-e2e')
      .send({ reason: 'Contracargo repetido', version: 1 })
      .expect(200);

    const { body } = await audit(
      `?action=customers.*&resourceType=user&resourceId=${customerId}`,
    ).expect(200);

    expect(body).toEqual({
      data: [
        {
          id: expect.any(String),
          occurredAt: expect.any(String),
          actorType: 'USER',
          actorId: manager.id,
          action: 'customers.suspend',
          resourceType: 'user',
          resourceId: customerId,
          result: 'SUCCESS',
          correlationId: suspension.headers['x-correlation-id'],
          ip: expect.any(String),
          userAgent: 'base-shop-e2e',
          changes: { status: { from: 'ACTIVE', to: 'SUSPENDED' } },
          reason: 'Contracargo repetido',
        },
      ],
      meta: { limit: 50, nextCursor: null },
    });
    expect(JSON.stringify(body)).not.toContain(`${customerId}@example.com`);
  });

  it('pages by cursor, newest first, without gaps nor repeats', async () => {
    const [oldest, middle, newest] = await recorded(
      { at: '2026-10-02T10:00:00.000Z' },
      { at: '2026-10-02T11:00:00.000Z' },
      { at: '2026-10-02T12:00:00.000Z' },
    );

    const first = (await audit('?limit=2').expect(200)).body;
    const second = (
      await audit(`?limit=2&cursor=${first.meta.nextCursor}`).expect(200)
    ).body;

    expect(first.data.map(({ id }: { id: string }) => id)).toEqual([
      newest,
      middle,
    ]);
    expect(first.meta).toEqual({ limit: 2, nextCursor: expect.any(String) });
    expect(second).toEqual({
      data: [expect.objectContaining({ id: oldest })],
      meta: { limit: 2, nextCursor: null },
    });
  });

  it('filters by action prefix, actor type, result and a date range whose end includes the whole day', async () => {
    const [included, , denied, nextDay] = await recorded(
      { at: '2026-10-01T23:59:59.999Z', action: 'orders.cancel' },
      { at: '2026-09-30T23:59:59.999Z', action: 'orders.cancel' },
      {
        at: '2026-10-01T10:00:00.000Z',
        action: 'http.access-denied',
        result: 'DENIED',
      },
      { at: '2026-10-02T00:00:00.000Z', action: 'orders.cancel' },
    );
    const idsOf = async (query: string) =>
      (await audit(query).expect(200)).body.data.map(
        ({ id }: { id: string }) => id,
      );

    expect(
      await idsOf('?action=orders.*&from=2026-10-01&to=2026-10-01'),
    ).toEqual([included]);
    expect(await idsOf('?result=DENIED,FAILED')).toEqual([denied]);
    expect(await idsOf('?actorType=USER,ANONYMOUS')).toEqual([]);
    expect(
      await idsOf('?action=orders.cancel&from=2026-10-02T00:00:00.000Z'),
    ).toEqual([nextDay]);
  });

  it('answers 400 for a cursor it did not give and for filters out of their rules', async () => {
    for (const position of [
      { id: 'x' },
      { occurredAt: 'ayer', id: newId() },
      { occurredAt: '2026-10-04T12:00:00.000Z', id: 'x' },
    ]) {
      const cursor = Buffer.from(JSON.stringify(position)).toString(
        'base64url',
      );

      expect((await audit(`?cursor=${cursor}`).expect(400)).body).toMatchObject(
        {
          type: '/problems/validation-error',
          errors: [
            expect.objectContaining({ field: 'cursor', code: 'cursor' }),
          ],
        },
      );
    }
    for (const query of [
      '?action=orders*',
      '?action=Orders.cancel',
      '?actorType=ROBOT',
      '?result=OK',
      '?actorId=yo',
      '?from=ayer',
      '?limit=101',
    ]) {
      await audit(query).expect(400);
    }
  });

  it('needs audit.read, and changes or deletes nothing', async () => {
    await http().get('/v1/admin/audit').expect(401);
    const outsider = staff('orders.read');
    await audit('', outsider).expect(403);
    await http().delete('/v1/admin/audit').set(signedInAs(auditor)).expect(404);

    const { body } = await audit('?action=http.access-denied').expect(200);
    expect(body.data).toEqual([
      expect.objectContaining({
        actorId: outsider.id,
        result: 'DENIED',
        resourceType: 'route',
      }),
    ]);
  });
});
