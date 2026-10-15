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

const IMPORTS = '/v1/admin/inventory/receipt-imports';
/** The list the migration creates (ADR-0125). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const HEADER = 'sku,warehouse,quantity';

/** A template of `docs/templates`, as a spreadsheet saves it: with a byte order mark and CRLF line ends. */
const template = (name: string) =>
  Buffer.from(
    `﻿${readFileSync(`docs/templates/${name}`, 'utf8').replace(/\n/g, '\r\n')}`,
  );

/** Bulk import of receipts over HTTP (T-146 part b, UC-INV-12, API_SPEC.md §13). */
describe('Bulk import of receipts (e2e, T-146 part b)', () => {
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
    // The brand and the categories the template of products uses.
    await prisma.brand.create({
      data: {
        id: newId(),
        name: 'Marca Ejemplo',
        slug: 'marca-ejemplo',
        status: 'ACTIVE',
      },
    });
    await prisma.category.createMany({
      data: ['camisas', 'hombre', 'accesorios'].map((slug) => ({
        id: newId(),
        name: slug,
        slug,
        status: 'ACTIVE' as const,
      })),
    });
    await upload(template('products.csv'), {
      path: '/v1/admin/catalog/product-imports',
    }).expect(200);
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.stockReceiptImport.deleteMany();
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
          { action: 'inventory.receipt-import' },
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
    staffWith(
      'catalog.write',
      'pricing.write',
      'inventory.read',
      'inventory.write',
    );

  function upload(
    content: string | Buffer,
    { path = IMPORTS, query = '' }: { path?: string; query?: string } = {},
  ) {
    return http()
      .post(`${path}${query}`)
      .set(writer())
      .attach(
        'file',
        typeof content === 'string' ? Buffer.from(content) : content,
        { filename: 'existencias.csv', contentType: 'text/csv' },
      );
  }

  const stockOf = async (sku: string) =>
    (
      await http()
        .get(`/v1/admin/inventory/stock-items?sku=${sku}`)
        .set(writer())
        .expect(200)
    ).body.data;

  it('imports the three templates in order: the products, their prices and their stock', async () => {
    await upload(template('prices.csv'), {
      path: `/v1/admin/pricing/price-lists/${DEFAULT_LIST}/imports`,
    }).expect(200);

    const response = await upload(template('stock.csv')).expect(200);

    expect(response.body).toEqual({ rows: 4, units: 100, dryRun: false });
    const [shirt] = await stockOf('CAM-LINO-M-BL');
    expect(shirt).toMatchObject({ onHand: 25, reserved: 0, available: 25 });
    const movements = await http()
      .get(`/v1/admin/inventory/stock-items/${shirt.id}/movements`)
      .set(writer())
      .expect(200);
    expect(movements.body.data).toEqual([
      expect.objectContaining({
        type: 'RECEIPT',
        quantity: 25,
        onHandAfter: 25,
        note: 'Remisión 1234',
        actorId: staffId,
      }),
    ]);
    expect(await stockOf('GORRA-ALG')).toEqual([
      expect.objectContaining({ onHand: 40 }),
    ]);
  });

  it('refuses the same file again with 409, saying when it was imported, and adds nothing', async () => {
    await upload(template('stock.csv')).expect(200);

    const response = await upload(template('stock.csv')).expect(409);

    expect(response.body).toMatchObject({
      type: '/problems/duplicate-value',
      field: 'file',
      importedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await stockOf('CAM-LINO-M-BL')).toEqual([
      expect.objectContaining({ onHand: 25 }),
    ]);
  });

  it('with dryRun, answers what it would add and saves nothing, so the file can be imported afterwards', async () => {
    const response = await upload(template('stock.csv'), {
      query: '?dryRun=true',
    }).expect(200);

    expect(response.body).toEqual({ rows: 4, units: 100, dryRun: true });
    expect(await stockOf('CAM-LINO-M-BL')).toEqual([]);
    await upload(template('stock.csv')).expect(200);
  });

  it('answers 400 with the errors of the rows, and adds nothing', async () => {
    const response = await upload(
      `${HEADER}\n` +
        'NO-EXISTE,PRINCIPAL,5\n' +
        'GORRA-ALG,BODEGA,5\n' +
        'GORRA-ALG,PRINCIPAL,0\n',
    ).expect(400);

    expect(response.body).toMatchObject({
      type: '/problems/validation-error',
      errors: [
        {
          field: 'rows[2].sku',
          code: 'unknownSku',
          message: 'No existe una variante con este SKU.',
        },
        expect.objectContaining({
          field: 'rows[3].warehouse',
          code: 'unknownWarehouse',
        }),
        expect.objectContaining({
          field: 'rows[4].quantity',
          code: 'quantity',
        }),
      ],
    });
    expect(await prisma.stockItem.count()).toBe(0);
  });

  it.each([
    ['another encoding', Buffer.from([0x73, 0x6b, 0x75, 0xe9, 0x0a]), 'utf8'],
    ['an unknown column', `${HEADER},costo\nA,B,1,9\n`, 'columns'],
    ['only the header', `${HEADER}\n`, 'emptyFile'],
  ])('answers 400 on file for %s', async (_, content, code) => {
    const response = await upload(content).expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field: 'file', code }),
    ]);
  });

  it('answers 400 without a file, and for a dryRun that is not true or false', async () => {
    const noFile = await http().post(IMPORTS).set(writer()).expect(400);
    const dryRun = await upload(`${HEADER}\nA,B,1\n`, {
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
      Buffer.concat([
        Buffer.from(`${HEADER},note\n`),
        Buffer.alloc(1_048_576, 'a'),
      ]),
    ).expect(413);

    expect(response.body).toMatchObject({
      type: '/problems/payload-too-large',
      maxBytes: 1_048_576,
    });
  });

  it('answers 403 without inventory.write', async () => {
    await http()
      .post(IMPORTS)
      .set(staffWith('inventory.read'))
      .attach('file', template('stock.csv'), 'existencias.csv')
      .expect(403);
    expect(await prisma.stockItem.count()).toBe(0);
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

    expect(operation.tags).toEqual(['Administración: inventario']);
    expect(Object.keys(operation.requestBody.content)).toEqual([
      'multipart/form-data',
    ]);
  });
});
