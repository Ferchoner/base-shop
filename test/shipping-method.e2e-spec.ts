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

const METHOD = '/v1/admin/shipping/method';

/** The method the migration creates, with the provisional values of ADR-0092. */
const SEEDED_ID = '01a0f401-1b74-71ec-b896-7680a8d24293';
const SEEDED = {
  name: 'Envío Estándar',
  flatFee: 9_900,
  freeShippingThreshold: 150_000,
  deliveryMinBusinessDays: 3,
  deliveryMaxBusinessDays: 7,
};

/** The shipping method over HTTP (T-196, UC-SHI-02, API_SPEC.md §17). */
describe('Shipping method (e2e, T-196)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const adminId = newId();

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
    await prisma.shippingMethod.update({
      where: { id: SEEDED_ID },
      data: SEEDED,
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['shipping-method.update', 'http.access-denied'] },
      },
    });
    await app.close();
    jest.restoreAllMocks();
  });

  function staffWith(...permissions: AuthenticatedUser['permissions']) {
    return signedInAs({
      id: adminId,
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });
  }

  const http = () => request(app.getHttpServer());
  const administrator = () =>
    staffWith('shipping.manage', 'shipping.configure');

  async function currentVersion(): Promise<number> {
    const response = await http().get(METHOD).set(administrator()).expect(200);
    return response.body.version as number;
  }

  it('shows the method with shipping.manage, amounts as Money', async () => {
    const response = await http()
      .get(METHOD)
      .set(staffWith('shipping.manage'))
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      id: SEEDED_ID,
      name: 'Envío Estándar',
      flatFee: { amount: 9_900, currency: 'MXN' },
      freeShippingThreshold: { amount: 150_000, currency: 'MXN' },
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
      isActive: true,
      version: expect.any(Number),
      updatedAt: expect.any(String),
    });
  });

  it('is configured only with shipping.configure (ADR-0075)', async () => {
    const version = await currentVersion();

    await http()
      .put(METHOD)
      .set(staffWith('shipping.manage'))
      .send({ ...SEEDED, flatFee: 0, version })
      .expect(403);
    await http().get(METHOD).set(staffWith('orders.read')).expect(403);
    await http().get(METHOD).expect(401);

    expect(await currentVersion()).toBe(version);
  });

  it('replaces every setting, turns free shipping off with null, and audits the change', async () => {
    const version = await currentVersion();

    const response = await http()
      .put(METHOD)
      .set(staffWith('shipping.configure'))
      .send({
        name: 'Envío Nacional',
        flatFee: 12_900,
        freeShippingThreshold: null,
        deliveryMinBusinessDays: 2,
        deliveryMaxBusinessDays: 5,
        version,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      name: 'Envío Nacional',
      flatFee: { amount: 12_900, currency: 'MXN' },
      freeShippingThreshold: null,
      deliveryMinBusinessDays: 2,
      deliveryMaxBusinessDays: 5,
      version: version + 1,
    });
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'shipping-method.update', actorId: adminId },
        orderBy: { occurredAt: 'desc' },
      }),
    ).toMatchObject({ resourceId: SEEDED_ID, result: 'SUCCESS' });
  });

  it('answers 409 version-conflict with the current version', async () => {
    const version = await currentVersion();
    await http()
      .put(METHOD)
      .set(administrator())
      .send({ ...SEEDED, flatFee: 10_000, version })
      .expect(200);

    const response = await http()
      .put(METHOD)
      .set(administrator())
      .send({ ...SEEDED, flatFee: 20_000, version })
      .expect(409);

    expect(response.body).toMatchObject({
      type: '/problems/version-conflict',
      currentVersion: version + 1,
    });
  });

  it.each([
    [{ name: '   ' }, 'name'],
    [{ name: 'a'.repeat(101) }, 'name'],
    [{ flatFee: -1 }, 'flatFee'],
    [{ flatFee: 99.5 }, 'flatFee'],
    [{ flatFee: 2_147_483_648 }, 'flatFee'],
    [{ freeShippingThreshold: 0 }, 'freeShippingThreshold'],
    [{ freeShippingThreshold: undefined }, 'freeShippingThreshold'],
    [{ deliveryMinBusinessDays: 0 }, 'deliveryMinBusinessDays'],
    [{ deliveryMaxBusinessDays: 31 }, 'deliveryMaxBusinessDays'],
    [{ version: undefined }, 'version'],
    [{ isActive: false }, 'isActive'],
  ])('answers 400 validation-error for %j', async (changes, field) => {
    const body = { ...SEEDED, version: await currentVersion(), ...changes };

    const response = await http()
      .put(METHOD)
      .set(administrator())
      .send(body)
      .expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it('requires freeShippingThreshold, even as null, with its own message', async () => {
    const body: Record<string, unknown> = {
      ...SEEDED,
      version: await currentVersion(),
    };
    delete body.freeShippingThreshold;

    const response = await http()
      .put(METHOD)
      .set(administrator())
      .send(body)
      .expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        {
          field: 'freeShippingThreshold',
          code: 'isDefined',
          message: 'Es obligatorio.',
        },
      ]),
    );
  });

  it('rejects a delivery range whose maximum is below its minimum', async () => {
    const response = await http()
      .put(METHOD)
      .set(administrator())
      .send({
        ...SEEDED,
        deliveryMinBusinessDays: 5,
        deliveryMaxBusinessDays: 4,
        version: await currentVersion(),
      })
      .expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({
        field: 'deliveryMaxBusinessDays',
        code: 'deliveryRange',
      }),
    ]);
  });

  it('documents both operations in OpenAPI', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const document = response.body as {
      paths: Record<string, Record<string, { tags: string[] }>>;
      components: { schemas: Record<string, unknown> };
    };

    expect(document.paths[METHOD].get.tags).toEqual(['Administración: envíos']);
    expect(document.paths[METHOD].put).toBeDefined();
    expect(document.components.schemas.MoneyDto).toBeDefined();
  });
});
