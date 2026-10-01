import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const LISTS = '/v1/admin/pricing/price-lists';
/** The list the migration creates (ADR-0125). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const DAY = 86_400_000;

/** Price lists and prices over HTTP (T-145 part a, UC-PRC-01 to 04, API_SPEC.md §12). */
describe('Pricing (e2e, T-145 part a)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const staffId = newId();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    // In development, so the OpenAPI document is served too (ADR-0096).
    const config = app.get(ConfigService);
    const realGet = config.get.bind(config) as (key: string) => unknown;
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'development' : realGet(key),
      );
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'prices.' } },
          { action: 'http.access-denied' },
        ],
      },
    });
    await app.close();
    jest.restoreAllMocks();
  });

  function staffWith(...permissions: AuthenticatedUser['permissions']) {
    return signedInAs({
      id: staffId,
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });
  }

  const http = () => request(app.getHttpServer());
  const writer = () => staffWith('pricing.read', 'pricing.write');
  const periodsOf = (variantId: string, list = DEFAULT_LIST) =>
    `${LISTS}/${list}/variants/${variantId}/periods`;

  /** A discontinued variant of a draft product: any variant can have prices. */
  async function createVariant(): Promise<string> {
    const productId = newId();
    const variantId = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: `Camisa ${productId}`,
        slug: `camisa-${productId}`,
        status: 'DRAFT',
        variants: {
          create: {
            id: variantId,
            sku: `SKU-${variantId}`.toUpperCase(),
            options: {},
            status: 'DISCONTINUED',
          },
        },
      },
    });
    return variantId;
  }

  const setPrice = (variantId: string, body: Record<string, unknown>) =>
    http().post(periodsOf(variantId)).set(writer()).send(body);

  it('lists the default list', async () => {
    const response = await http()
      .get(LISTS)
      .set(staffWith('pricing.read'))
      .expect(200);

    expect(response.body).toEqual({
      data: [
        {
          id: DEFAULT_LIST,
          code: 'GENERAL',
          name: 'Lista general',
          currency: 'MXN',
          priority: 0,
          isDefault: true,
          taxesIncluded: true,
          status: 'ACTIVE',
        },
      ],
    });
  });

  it('sets a price from now on, answers the same price with the current period, and schedules another one', async () => {
    const variantId = await createVariant();
    const nextWeek = new Date(Date.now() + 7 * DAY).toISOString();

    const first = await setPrice(variantId, {
      amount: 59_900,
      compareAtAmount: 79_900,
    }).expect(201);
    const same = await setPrice(variantId, {
      amount: 59_900,
      compareAtAmount: 79_900,
      effectiveFrom: null,
    }).expect(200);
    const sale = await setPrice(variantId, {
      amount: 49_900,
      effectiveFrom: nextWeek,
    }).expect(201);
    const history = await http()
      .get(periodsOf(variantId))
      .set(staffWith('pricing.read'))
      .expect(200);
    const scheduled = await http()
      .get(`${periodsOf(variantId)}?state=SCHEDULED`)
      .set(staffWith('pricing.read'))
      .expect(200);

    expect(first.body).toEqual({
      id: expect.any(String),
      amount: { amount: 59_900, currency: 'MXN' },
      compareAtAmount: { amount: 79_900, currency: 'MXN' },
      effectiveFrom: expect.any(String),
      effectiveTo: null,
      state: 'CURRENT',
      createdBy: staffId,
      createdAt: first.body.effectiveFrom,
    });
    expect(same.body).toEqual(first.body);
    expect(sale.body).toMatchObject({
      amount: { amount: 49_900, currency: 'MXN' },
      compareAtAmount: null,
      effectiveFrom: nextWeek,
      effectiveTo: null,
      state: 'SCHEDULED',
    });
    expect(history.body).toEqual({
      data: [sale.body, { ...first.body, effectiveTo: nextWeek }],
      current: { ...first.body, effectiveTo: nextWeek },
    });
    expect(scheduled.body).toEqual({
      data: [sale.body],
      current: { ...first.body, effectiveTo: nextWeek },
    });
  });

  it('cancels a scheduled price, and answers 409 with reason for a period that began or one at the same instant', async () => {
    const variantId = await createVariant();
    const nextWeek = new Date(Date.now() + 7 * DAY).toISOString();
    const first = await setPrice(variantId, { amount: 59_900 }).expect(201);
    const sale = await setPrice(variantId, {
      amount: 49_900,
      effectiveFrom: nextWeek,
    }).expect(201);

    const sameInstant = await setPrice(variantId, {
      amount: 44_900,
      effectiveFrom: nextWeek,
    }).expect(409);
    const started = await http()
      .delete(`${periodsOf(variantId)}/${first.body.id}`)
      .set(writer())
      .expect(409);
    await http()
      .delete(`${periodsOf(variantId)}/${sale.body.id}`)
      .set(writer())
      .expect(204);
    await http()
      .delete(`${periodsOf(variantId)}/${sale.body.id}`)
      .set(writer())
      .expect(404);

    expect(sameInstant.body).toMatchObject({
      type: '/problems/price-period-conflict',
      reason: 'overlap',
    });
    expect(started.body).toMatchObject({
      type: '/problems/price-period-conflict',
      reason: 'already-started',
    });
    const history = await http()
      .get(periodsOf(variantId))
      .set(writer())
      .expect(200);
    expect(history.body.data).toEqual([
      expect.objectContaining({ id: first.body.id, effectiveTo: null }),
    ]);
  });

  it.each([
    [{ amount: -1 }, 'amount', 'min'],
    [{ amount: 599.5 }, 'amount', 'isInt'],
    [
      { amount: 59_900, compareAtAmount: 59_900 },
      'compareAtAmount',
      'compareAtAmount',
    ],
    [
      { amount: 59_900, effectiveFrom: '2026-11-14T06:00:00' },
      'effectiveFrom',
      'matches',
    ],
    [
      { amount: 59_900, effectiveFrom: '2026-02-30T06:00:00Z' },
      'effectiveFrom',
      'isIso8601',
    ],
    [
      { amount: 59_900, effectiveTo: null },
      'effectiveTo',
      'whitelistValidation',
    ],
  ])('answers 400 for %j', async (body, field, code) => {
    const variantId = await createVariant();

    const response = await setPrice(variantId, body).expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field, code }),
    ]);
  });

  it('answers 400 for an unknown state filter', async () => {
    const variantId = await createVariant();

    const response = await http()
      .get(`${periodsOf(variantId)}?state=CURRENT,FUTURE`)
      .set(writer())
      .expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field: 'state', code: 'isIn' }),
    ]);
  });

  it('answers 404 for a missing or malformed list, variant or period', async () => {
    const variantId = await createVariant();

    await setPrice(newId(), { amount: 59_900 }).expect(404);
    await setPrice('talla-m', { amount: 59_900 }).expect(404);
    await http()
      .post(periodsOf(variantId, newId()))
      .set(writer())
      .send({ amount: 59_900 })
      .expect(404);
    await http().get(periodsOf(variantId, 'general')).set(writer()).expect(404);
    await http()
      .delete(`${periodsOf(variantId)}/${newId()}`)
      .set(writer())
      .expect(404);
    await http()
      .delete(`${periodsOf(variantId)}/actual`)
      .set(writer())
      .expect(404);
    expect(await prisma.variantPrice.count()).toBe(0);
  });

  it('reads with pricing.read and changes only with pricing.write', async () => {
    const variantId = await createVariant();

    await http().get(LISTS).set(staffWith('catalog.read')).expect(403);
    await http()
      .get(periodsOf(variantId))
      .set(staffWith('pricing.read'))
      .expect(200);
    await http()
      .post(periodsOf(variantId))
      .set(staffWith('pricing.read'))
      .send({ amount: 59_900 })
      .expect(403);
    await http()
      .delete(`${periodsOf(variantId)}/${newId()}`)
      .set(staffWith('pricing.read'))
      .expect(403);
  });

  it('documents the endpoints in OpenAPI', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const document = response.body as {
      paths: Record<string, Record<string, { tags: string[] }>>;
    };
    const periods = `${LISTS}/{priceListId}/variants/{variantId}/periods`;

    expect(document.paths[LISTS].get.tags).toEqual(['Administración: precios']);
    expect(Object.keys(document.paths[periods]).sort()).toEqual([
      'get',
      'post',
    ]);
    expect(document.paths[`${periods}/{periodId}`].delete).toBeDefined();
  });
});
