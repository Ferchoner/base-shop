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
const IMPORTS = `${LISTS}/${DEFAULT_LIST}/imports`;
const HEADER = 'sku,amount,compareAtAmount,effectiveFrom';

/** Bulk import of prices over HTTP (T-145 part b, UC-PRC-05, API_SPEC.md §12). */
describe('Bulk import of prices (e2e, T-145 part b)', () => {
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

  /** Variants of a new product with these SKUs, and their IDs. */
  async function createVariants(...skus: string[]): Promise<string[]> {
    const productId = newId();
    const ids = skus.map(() => newId());
    await prisma.product.create({
      data: {
        id: productId,
        title: `Camisa ${productId}`,
        slug: `camisa-${productId}`,
        status: 'DRAFT',
      },
    });
    await prisma.productVariant.createMany({
      data: skus.map((sku, index) => ({
        id: ids[index],
        productId,
        sku,
        options: { n: String(index) },
        status: 'ACTIVE' as const,
      })),
    });
    return ids;
  }

  const upload = (
    content: string | Buffer,
    { path = IMPORTS, query = '' }: { path?: string; query?: string } = {},
  ) =>
    http()
      .post(`${path}${query}`)
      .set(writer())
      .attach(
        'file',
        typeof content === 'string' ? Buffer.from(content) : content,
        { filename: 'precios.csv', contentType: 'text/csv' },
      );

  const periodsOf = (variantId: string) =>
    http()
      .get(`${LISTS}/${DEFAULT_LIST}/variants/${variantId}/periods`)
      .set(writer())
      .expect(200);

  it('imports a CSV made in a spreadsheet, and answers what it did', async () => {
    const [shirt, cap] = await createVariants('CAM-LINO-M', 'GORRA-AZUL');

    const response = await upload(
      `﻿${HEADER}\r\nCAM-LINO-M,599.00,799.00,\r\nCAM-LINO-M,499.00,799.00,2099-11-14 00:00\r\ngorra-azul,199,,\r\n`,
    ).expect(200);

    expect(response.body).toEqual({
      rows: 3,
      created: 3,
      unchanged: 0,
      dryRun: false,
    });
    const shirtPeriods = (await periodsOf(shirt)).body;
    expect(shirtPeriods.data).toEqual([
      expect.objectContaining({
        amount: { amount: 49_900, currency: 'MXN' },
        compareAtAmount: { amount: 79_900, currency: 'MXN' },
        // Midnight in Mexico's time.
        effectiveFrom: '2099-11-14T06:00:00.000Z',
        state: 'SCHEDULED',
        createdBy: staffId,
      }),
      expect.objectContaining({
        amount: { amount: 59_900, currency: 'MXN' },
        effectiveTo: '2099-11-14T06:00:00.000Z',
        state: 'CURRENT',
      }),
    ]);
    expect((await periodsOf(cap)).body.current).toMatchObject({
      amount: { amount: 19_900, currency: 'MXN' },
    });
  });

  it('answers what a dry run would do, and writes nothing', async () => {
    const [shirt] = await createVariants('CAM-LINO-M');

    const response = await upload(`${HEADER}\nCAM-LINO-M,599,,\n`, {
      query: '?dryRun=true',
    }).expect(200);

    expect(response.body).toEqual({
      rows: 1,
      created: 1,
      unchanged: 0,
      dryRun: true,
    });
    expect((await periodsOf(shirt)).body).toEqual({ data: [], current: null });
  });

  it('answers 400 with the errors of each row by line, and imports none of them', async () => {
    const [shirt] = await createVariants('CAM-LINO-M');

    const response = await upload(
      `${HEADER}\nCAM-LINO-M,599,,\n\nNO-EXISTE,599,,\nCAM-LINO-M,1.599,,\n`,
    ).expect(400);

    expect(response.body).toMatchObject({
      type: '/problems/validation-error',
      errors: [
        { field: 'rows[4].sku', code: 'unknownSku' },
        { field: 'rows[5].amount', code: 'pesos' },
      ],
    });
    expect((await periodsOf(shirt)).body.data).toEqual([]);
  });

  it.each([
    ['another encoding', Buffer.from([0x73, 0x6b, 0x75, 0xe9, 0x0a]), 'utf8'],
    ['other columns', 'sku,precio\nA,1\n', 'columns'],
    ['only the header', `${HEADER}\n`, 'emptyFile'],
  ])('answers 400 on file for %s', async (_, content, code) => {
    const response = await upload(content).expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field: 'file', code }),
    ]);
  });

  it('answers 400 without a file, and for a dryRun that is not true or false', async () => {
    const noFile = await http().post(IMPORTS).set(writer()).expect(400);
    const dryRun = await upload(`${HEADER}\nA,1,,\n`, {
      query: '?dryRun=si',
    }).expect(400);

    expect(noFile.body.errors).toEqual([
      expect.objectContaining({ field: 'file', code: 'isDefined' }),
    ]);
    expect(dryRun.body.errors).toEqual([
      expect.objectContaining({ field: 'dryRun', code: 'isBoolean' }),
    ]);
  });

  it('answers 413 with maxBytes for a file over 1 MB', async () => {
    const response = await upload(
      Buffer.concat([Buffer.from(`${HEADER}\n`), Buffer.alloc(1_048_576, 'a')]),
    ).expect(413);

    expect(response.body).toMatchObject({
      type: '/problems/payload-too-large',
      maxBytes: 1_048_576,
    });
  });

  it('answers 404 for a missing or malformed list, and 403 without pricing.write', async () => {
    await createVariants('CAM-LINO-M');
    const file = `${HEADER}\nCAM-LINO-M,599,,\n`;

    await upload(file, { path: `${LISTS}/${newId()}/imports` }).expect(404);
    await upload(file, { path: `${LISTS}/general/imports` }).expect(404);
    await http()
      .post(IMPORTS)
      .set(staffWith('pricing.read'))
      .attach('file', Buffer.from(file), 'precios.csv')
      .expect(403);
    expect(await prisma.pricePeriod.count()).toBe(0);
  });

  it('documents the import in OpenAPI as a multipart upload', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const operation = (
      response.body as {
        paths: Record<
          string,
          Record<string, { tags: string[]; requestBody: { content: object } }>
        >;
      }
    ).paths[`${LISTS}/{priceListId}/imports`].post;

    expect(operation.tags).toEqual(['Administración: precios']);
    expect(Object.keys(operation.requestBody.content)).toEqual([
      'multipart/form-data',
    ]);
  });
});
