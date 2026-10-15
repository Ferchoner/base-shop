import { readFileSync } from 'node:fs';
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

const IMPORTS = '/v1/admin/catalog/product-imports';
/** The list the migration creates (ADR-0125). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const HEADER = 'slug,title,sku';

/** A template of `docs/templates`, as a spreadsheet saves it: with a byte order mark and CRLF line ends. */
const template = (name: string) =>
  Buffer.from(
    `﻿${readFileSync(`docs/templates/${name}`, 'utf8').replace(/\n/g, '\r\n')}`,
  );

/** Bulk import of products over HTTP (T-146 part a, UC-CAT-16, API_SPEC.md §11.11). */
describe('Bulk import of products (e2e, T-146 part a)', () => {
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

  beforeEach(async () => {
    // The brand and the categories the templates use.
    await prisma.brand.create({
      data: {
        id: newId(),
        name: 'Marca Ejemplo',
        slug: 'marca-ejemplo',
        status: 'ACTIVE',
      },
    });
    await prisma.category.createMany({
      data: ['Camisas', 'Hombre', 'Accesorios'].map((name) => ({
        id: newId(),
        name,
        slug: name.toLowerCase(),
        status: 'ACTIVE' as const,
      })),
    });
  });

  afterEach(async () => {
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.productCategory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.brand.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: 'products.import' },
          { action: 'prices.import' },
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
  const writer = () =>
    staffWith('catalog.read', 'catalog.write', 'pricing.write');

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
        { filename: 'productos.csv', contentType: 'text/csv' },
      );

  it('imports the templates in order, the products in DRAFT and then their prices', async () => {
    const products = await upload(template('products.csv')).expect(200);
    const prices = await upload(template('prices.csv'), {
      path: `/v1/admin/pricing/price-lists/${DEFAULT_LIST}/imports`,
    }).expect(200);

    expect(products.body).toEqual({
      rows: 4,
      products: 2,
      variants: 4,
      dryRun: false,
    });
    expect(prices.body).toEqual({
      rows: 4,
      created: 4,
      unchanged: 0,
      dryRun: false,
    });
    const listed = await http()
      .get('/v1/admin/catalog/products?sort=title')
      .set(writer())
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        slug: 'camisa-lino',
        title: 'Camisa de lino',
        status: 'DRAFT',
        brand: expect.objectContaining({ name: 'Marca Ejemplo' }),
        categories: expect.arrayContaining([
          expect.objectContaining({ name: 'Camisas' }),
          expect.objectContaining({ name: 'Hombre' }),
        ]),
        variants: [
          expect.objectContaining({
            sku: 'CAM-LINO-M-BL',
            gtin: '7501055363063',
            options: { talla: 'M', color: 'Blanco' },
            weightGrams: 250,
            lengthCm: 30,
          }),
          expect.objectContaining({
            sku: 'CAM-LINO-G-BL',
            options: { talla: 'G', color: 'Blanco' },
          }),
          expect.objectContaining({
            sku: 'CAM-LINO-M-AZ',
            options: { talla: 'M', color: 'Azul' },
          }),
        ],
      }),
      expect.objectContaining({
        slug: 'gorra-algodon',
        title: 'Gorra de algodón',
        variants: [expect.objectContaining({ sku: 'GORRA-ALG', options: {} })],
      }),
    ]);
    const detail = await http()
      .get(`/v1/admin/catalog/products/${listed.body.data[0].id}`)
      .set(writer())
      .expect(200);
    expect(detail.body.description).toBe(
      'Camisa de lino fresca y ligera, ideal para el calor.',
    );
  });

  it('with dryRun, answers what it would create and saves nothing', async () => {
    const response = await upload(template('products.csv'), {
      query: '?dryRun=true',
    }).expect(200);

    expect(response.body).toEqual({
      rows: 4,
      products: 2,
      variants: 4,
      dryRun: true,
    });
    expect(await prisma.product.count()).toBe(0);
  });

  it('answers 400 with the errors of the rows, and imports nothing', async () => {
    await upload(`${HEADER}\ncamisa,Camisa,CAM-1\n`).expect(200);

    const response = await upload(
      `${HEADER},option:talla,weightGrams\n` +
        'camisa,Camisa,CAM-2,M,250\n' +
        'gorra,Gorra,CAM 3,,1.5\n' +
        'gorra,Otra,GORRA,,\n',
    ).expect(400);

    expect(response.body).toMatchObject({
      type: '/problems/validation-error',
      errors: [
        {
          field: 'rows[2].slug',
          code: 'taken',
          message: 'Ya hay un producto con este slug, aunque esté archivado.',
        },
        expect.objectContaining({ field: 'rows[3].sku', code: 'matches' }),
        expect.objectContaining({
          field: 'rows[3].weightGrams',
          code: 'grams',
        }),
        expect.objectContaining({
          field: 'rows[4].title',
          code: 'differsFromProduct',
        }),
      ],
    });
    expect(await prisma.product.count()).toBe(1);
  });

  it.each([
    ['another encoding', Buffer.from([0x73, 0x6c, 0x75, 0xe9, 0x0a]), 'utf8'],
    ['an unknown column', `${HEADER},precio\na,b,c,1\n`, 'columns'],
    ['only the header', `${HEADER}\n`, 'emptyFile'],
  ])('answers 400 on file for %s', async (_, content, code) => {
    const response = await upload(content).expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field: 'file', code }),
    ]);
  });

  it('answers 400 without a file, and for a dryRun that is not true or false', async () => {
    const noFile = await http().post(IMPORTS).set(writer()).expect(400);
    const dryRun = await upload(`${HEADER}\na,A,B\n`, {
      query: '?dryRun=si',
    }).expect(400);

    expect(noFile.body.errors).toEqual([
      expect.objectContaining({ field: 'file', code: 'isDefined' }),
    ]);
    expect(dryRun.body.errors).toEqual([
      expect.objectContaining({ field: 'dryRun', code: 'isBoolean' }),
    ]);
  });

  it('answers 413 with maxBytes for a file over 5 MB', async () => {
    const response = await upload(
      Buffer.concat([
        Buffer.from(`${HEADER},description\n`),
        Buffer.alloc(5_242_880, 'a'),
      ]),
    ).expect(413);

    expect(response.body).toMatchObject({
      type: '/problems/payload-too-large',
      maxBytes: 5_242_880,
    });
  });

  it('answers 403 without catalog.write', async () => {
    await http()
      .post(IMPORTS)
      .set(staffWith('catalog.read'))
      .attach('file', Buffer.from(`${HEADER}\na,A,B\n`), 'productos.csv')
      .expect(403);
    expect(await prisma.product.count()).toBe(0);
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
    ).paths[IMPORTS].post;

    expect(operation.tags).toEqual(['Administración: catálogo']);
    expect(Object.keys(operation.requestBody.content)).toEqual([
      'multipart/form-data',
    ]);
  });
});
