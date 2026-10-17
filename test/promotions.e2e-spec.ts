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

const PROMOTIONS = '/v1/admin/promotions';
const DAY = 86_400_000;
const inDays = (days: number) =>
  new Date(Date.now() + days * DAY).toISOString();

/** Promotions over HTTP (T-200 part a, UC-PRM-01 to 03, ADR-0168). */
describe('Promotions (e2e, T-200 part a)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const products: string[] = [];
  const brands: string[] = [];

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

  afterEach(async () => {
    await prisma.promotionTarget.deleteMany();
    await prisma.promotion.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'promotions.' } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: products.splice(0) } },
    });
    await prisma.brand.deleteMany({ where: { id: { in: brands.splice(0) } } });
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
  const administrator = staff('promotions.read', 'promotions.manage');
  /** As the seeded Vendedor role, which only reads promotions (ADR-0168). */
  const seller = staff('catalog.read', 'orders.place', 'promotions.read');

  async function product(status = 'PUBLISHED'): Promise<string> {
    const id = newId();
    products.push(id);
    await prisma.product.create({
      data: {
        id,
        title: 'Camisa de lino',
        slug: `camisa-${id}`,
        status: status as 'PUBLISHED',
      },
    });
    return id;
  }

  async function brand(): Promise<string> {
    const id = newId();
    brands.push(id);
    await prisma.brand.create({
      data: { id, name: 'Lino Fino', slug: `lino-${id}`, status: 'ACTIVE' },
    });
    return id;
  }

  const post = (body: object, as = administrator) =>
    http().post(PROMOTIONS).set(signedInAs(as)).send(body);

  async function created(body: object = {}) {
    return (
      await post({
        name: 'Buen Fin 10%',
        percentage: 10,
        startsAt: inDays(2),
        ...body,
      }).expect(201)
    ).body as { id: string; version: number; startsAt: string };
  }

  const patch = (id: string, body: object) =>
    http()
      .patch(`${PROMOTIONS}/${id}`)
      .set(signedInAs(administrator))
      .send(body);

  const end = (id: string, version: number) =>
    http()
      .post(`${PROMOTIONS}/${id}/end`)
      .set(signedInAs(administrator))
      .send({ version });

  describe('POST /v1/admin/promotions (UC-PRM-01)', () => {
    it('creates one with its targets named, and points to it', async () => {
      const shirt = await product();
      const lino = await brand();
      const startsAt = inDays(2);
      const endsAt = inDays(5);

      const response = await post({
        name: 'Buen Fin 10%',
        percentage: 10,
        targets: [
          { type: 'BRAND', id: lino },
          { type: 'PRODUCT', id: shirt.toUpperCase() },
        ],
        channels: ['STORE'],
        minimumSubtotal: 50_000,
        startsAt,
        endsAt,
      }).expect(201);

      expect(response.headers.location).toBe(
        `${PROMOTIONS}/${response.body.id}`,
      );
      expect(response.body).toEqual({
        id: response.body.id,
        name: 'Buen Fin 10%',
        status: 'SCHEDULED',
        percentage: 10,
        amountOff: null,
        targetCount: 2,
        channels: ['STORE'],
        minimumSubtotal: { amount: 50_000, currency: 'MXN' },
        startsAt,
        endsAt,
        endedAt: null,
        code: null,
        usageLimit: null,
        oncePerCustomer: false,
        uses: 0,
        targets: [
          { type: 'PRODUCT', id: shirt, name: 'Camisa de lino' },
          { type: 'BRAND', id: lino, name: 'Lino Fino' },
        ],
        endedBy: null,
        createdBy: administrator.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        version: 1,
      });
    });

    it('applies to the whole purchase in both channels by default, from now', async () => {
      const before = Date.now();

      const { body } = await post({
        name: 'Toda la tienda',
        amountOff: 20_000,
      }).expect(201);

      expect(body).toMatchObject({
        status: 'ACTIVE',
        percentage: null,
        amountOff: { amount: 20_000, currency: 'MXN' },
        targetCount: 0,
        targets: [],
        channels: ['ONLINE', 'STORE'],
        minimumSubtotal: null,
        endsAt: null,
      });
      expect(Date.parse(body.startsAt)).toBeGreaterThanOrEqual(before);
    });

    it('takes exactly one of the percentage and the amount', async () => {
      const both = await post({
        name: 'Doble',
        percentage: 10,
        amountOff: 100,
      }).expect(400);
      const neither = await post({ name: 'Ninguno' }).expect(400);

      expect(both.body.errors).toEqual([
        {
          field: 'amountOff',
          code: 'exclusive',
          message: 'Exactamente uno de `percentage` y `amountOff`.',
        },
      ]);
      expect(neither.body.errors).toEqual([
        {
          field: 'percentage',
          code: 'required',
          message: 'Exactamente uno de `percentage` y `amountOff`.',
        },
      ]);
    });

    it.each([
      [{ percentage: 0 }, 'percentage'],
      [{ percentage: 101 }, 'percentage'],
      [{ percentage: 12.5 }, 'percentage'],
      [{ percentage: 10, name: '   ' }, 'name'],
      [{ percentage: 10, name: 'x'.repeat(121) }, 'name'],
      [{ percentage: 10, channels: [] }, 'channels'],
      [{ percentage: 10, channels: ['ONLINE', 'ONLINE'] }, 'channels'],
      [{ percentage: 10, channels: ['CATALOG'] }, 'channels'],
      [{ percentage: 10, minimumSubtotal: 0 }, 'minimumSubtotal'],
      [{ percentage: 10, startsAt: '2026-11-13T06:00:00' }, 'startsAt'],
      [{ percentage: 10, endsAt: '2026-11-13' }, 'endsAt'],
      [
        { percentage: 10, targets: [{ type: 'SHOP', id: newId() }] },
        'targets[0].type',
      ],
      [
        { percentage: 10, targets: [{ type: 'BRAND', id: 'marca' }] },
        'targets[0].id',
      ],
    ])('refuses %j on %s', async (body, field) => {
      const response = await post({ name: 'Mala', ...body }).expect(400);

      expect(
        response.body.errors.map((error: { field: string }) => error.field),
      ).toEqual([field]);
    });

    it('refuses the same target twice and more than 100', async () => {
      const id = newId();

      const twice = await post({
        name: 'Repetida',
        percentage: 10,
        targets: [
          { type: 'BRAND', id },
          { type: 'BRAND', id: id.toUpperCase() },
        ],
      }).expect(400);
      const many = await post({
        name: 'Muchas',
        percentage: 10,
        targets: Array.from({ length: 101 }, () => ({
          type: 'BRAND',
          id: newId(),
        })),
      }).expect(400);

      expect(twice.body.errors[0]).toMatchObject({ field: 'targets' });
      expect(many.body.errors[0]).toMatchObject({ field: 'targets' });
    });

    it('refuses a target that does not exist or is archived, by its place', async () => {
      const archived = await product('ARCHIVED');

      const response = await post({
        name: 'Con faltantes',
        percentage: 10,
        targets: [
          { type: 'CATEGORY', id: newId() },
          { type: 'PRODUCT', id: archived },
        ],
      }).expect(400);

      expect(response.body).toMatchObject({
        type: expect.stringContaining('validation-error'),
        errors: [
          {
            field: 'targets[0].id',
            code: 'unknownTarget',
            message: 'No existe.',
          },
          { field: 'targets[1].id', code: 'unusableTarget' },
        ],
      });
      expect(await prisma.promotion.count()).toBe(0);
    });

    it('refuses an end before the start', async () => {
      const response = await post({
        name: 'Al revés',
        percentage: 10,
        startsAt: inDays(3),
        endsAt: inDays(2),
      }).expect(400);

      expect(response.body.errors).toEqual([
        {
          field: 'endsAt',
          code: 'afterStart',
          message: 'Debe ser posterior al inicio.',
        },
      ]);
    });

    it('is only for whoever manages promotions', async () => {
      await post({ name: 'Del vendedor', percentage: 10 }, seller).expect(403);
    });
  });

  describe('GET /v1/admin/promotions (UC-PRM-02)', () => {
    it('lists them by start, newest first, with their status now, for the seller too', async () => {
      const later = await created({ name: 'Después', startsAt: inDays(4) });
      const sooner = await created({ name: 'Antes', startsAt: inDays(1) });
      const active = await created({ name: 'Ahora', startsAt: undefined });

      const response = await http()
        .get(PROMOTIONS)
        .set(signedInAs(seller))
        .expect(200);

      expect(
        response.body.data.map(
          ({ id, status }: { id: string; status: string }) => [id, status],
        ),
      ).toEqual([
        [later.id, 'SCHEDULED'],
        [sooner.id, 'SCHEDULED'],
        [active.id, 'ACTIVE'],
      ]);
      expect(response.body.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 3,
        totalPages: 1,
      });
      expect(response.body.data[2]).not.toHaveProperty('targets');
    });

    it('filters by status, channel, reach and name, and sorts by name', async () => {
      await created({
        name: 'Marca',
        targets: [{ type: 'BRAND', id: await brand() }],
      });
      await created({
        name: 'Tienda',
        channels: ['STORE'],
        startsAt: undefined,
      });
      await created({ name: 'Línea', channels: ['ONLINE'] });

      const names = async (query: string) =>
        (
          await http()
            .get(`${PROMOTIONS}?${query}`)
            .set(signedInAs(administrator))
            .expect(200)
        ).body.data.map(({ name }: { name: string }) => name);

      expect(await names('status=ACTIVE')).toEqual(['Tienda']);
      expect(await names('status=SCHEDULED,ENDED&sort=name')).toEqual([
        'Línea',
        'Marca',
      ]);
      expect(await names('channel=ONLINE&sort=-name')).toEqual([
        'Marca',
        'Línea',
      ]);
      expect(await names('appliesTo=ITEMS')).toEqual(['Marca']);
      expect(await names('appliesTo=ORDER&sort=name')).toEqual([
        'Línea',
        'Tienda',
      ]);
      expect(await names('q=TIEN')).toEqual(['Tienda']);
    });

    it('refuses an unknown status or sort', async () => {
      for (const query of [
        'status=OPEN',
        'sort=percentage',
        'channel=WEB',
        'appliesTo=ALL',
      ]) {
        await http()
          .get(`${PROMOTIONS}?${query}`)
          .set(signedInAs(administrator))
          .expect(400);
      }
    });
  });

  describe('GET /v1/admin/promotions/{promotionId} (UC-PRM-02)', () => {
    it('reads one for the seller, and answers 404 for one that does not exist', async () => {
      const { id } = await created();

      await http()
        .get(`${PROMOTIONS}/${id}`)
        .set(signedInAs(seller))
        .expect(200);
      await http()
        .get(`${PROMOTIONS}/${newId()}`)
        .set(signedInAs(seller))
        .expect(404);
    });
  });

  describe('PATCH /v1/admin/promotions/{promotionId} (UC-PRM-03)', () => {
    it('changes what is sent before it starts, and audits it', async () => {
      const { id, startsAt } = await created();
      const lino = await brand();
      const later = inDays(3);

      const response = await patch(id, {
        amountOff: 15_000,
        targets: [{ type: 'BRAND', id: lino }],
        minimumSubtotal: 30_000,
        startsAt: later,
        version: 1,
      }).expect(200);

      expect(response.body).toMatchObject({
        name: 'Buen Fin 10%',
        percentage: null,
        amountOff: { amount: 15_000, currency: 'MXN' },
        targets: [{ type: 'BRAND', id: lino, name: 'Lino Fino' }],
        minimumSubtotal: { amount: 30_000, currency: 'MXN' },
        startsAt: later,
        version: 2,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'promotions.update', resourceId: id },
      });
      expect(audit.changes).toEqual({
        percentage: { from: 10, to: null },
        amountOff: { from: null, to: { amount: 15_000, currency: 'MXN' } },
        targets: { from: [], to: [{ type: 'BRAND', id: lino }] },
        minimumSubtotal: {
          from: null,
          to: { amount: 30_000, currency: 'MXN' },
        },
        startsAt: { from: startsAt, to: later },
      });
    });

    it('clears the minimum and the end with null, and keeps the version without changes', async () => {
      const { id } = await created({ minimumSubtotal: 100, endsAt: inDays(9) });

      const cleared = await patch(id, {
        minimumSubtotal: null,
        endsAt: null,
        version: 1,
      }).expect(200);
      const unchanged = await patch(id, {
        name: 'Buen Fin 10%',
        version: 2,
      }).expect(200);

      expect(cleared.body).toMatchObject({
        minimumSubtotal: null,
        endsAt: null,
        version: 2,
      });
      expect(unchanged.body.version).toBe(2);
    });

    it('changes only the name and the end once started', async () => {
      const { id, startsAt } = await created({ startsAt: undefined });

      const renamed = await patch(id, {
        name: 'Buen Fin extendido',
        endsAt: inDays(10),
        version: 1,
      }).expect(200);
      const locked = await patch(id, { percentage: 15, version: 2 }).expect(
        409,
      );
      // After its start, but already past.
      const past = await patch(id, {
        endsAt: new Date(Date.parse(startsAt) + 1).toISOString(),
        version: 2,
      }).expect(400);

      expect(renamed.body).toMatchObject({
        name: 'Buen Fin extendido',
        version: 2,
      });
      expect(locked.body).toMatchObject({
        type: expect.stringContaining('invalid-state-transition'),
        currentStatus: 'ACTIVE',
      });
      expect(past.body.errors).toEqual([
        expect.objectContaining({ field: 'endsAt', code: 'inFuture' }),
      ]);
    });

    it('refuses an outdated version, null for a required term, and both discounts', async () => {
      const { id } = await created();

      const stale = await patch(id, { name: 'Otra', version: 2 }).expect(409);
      const blank = await patch(id, { name: null, version: 1 }).expect(400);
      const both = await patch(id, {
        percentage: 5,
        amountOff: 5,
        version: 1,
      }).expect(400);
      await patch(id, { name: 'Sin versión' }).expect(400);

      expect(stale.body).toMatchObject({ currentVersion: 1 });
      expect(blank.body.errors[0]).toMatchObject({ field: 'name' });
      expect(both.body.errors[0]).toMatchObject({
        field: 'amountOff',
        code: 'exclusive',
      });
    });

    it('answers 404 for a promotion that does not exist, and 403 to the seller', async () => {
      await patch(newId(), { name: 'Otra', version: 1 }).expect(404);
      const { id } = await created();
      await http()
        .patch(`${PROMOTIONS}/${id}`)
        .set(signedInAs(seller))
        .send({ name: 'Otra', version: 1 })
        .expect(403);
    });
  });

  describe('POST /v1/admin/promotions/{promotionId}/end (UC-PRM-03)', () => {
    it('ends one now, once, and keeps who did it', async () => {
      const { id } = await created({ startsAt: undefined });

      const response = await end(id, 1).expect(200);
      const again = await end(id, 2).expect(409);
      await patch(id, { name: 'Otra', version: 2 }).expect(409);

      expect(response.body).toMatchObject({
        status: 'ENDED',
        endedBy: administrator.id,
        endedAt: expect.any(String),
        version: 2,
      });
      expect(again.body).toMatchObject({ currentStatus: 'ENDED' });
      expect(
        await prisma.auditLog.count({
          where: { action: 'promotions.end', resourceId: id },
        }),
      ).toBe(1);
    });

    it('refuses an outdated version and a promotion that does not exist', async () => {
      const { id } = await created();

      await end(id, 3).expect(409);
      await end(newId(), 1).expect(404);
      await http()
        .post(`${PROMOTIONS}/${id}/end`)
        .set(signedInAs(administrator))
        .send({})
        .expect(400);
    });
  });
});
