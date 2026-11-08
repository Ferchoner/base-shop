import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
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

const INVENTORY = '/v1/admin/inventory';
const COUNTS = `${INVENTORY}/counts`;
/** The warehouse the migration creates (ADR-0127), here the store 204. */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

/** Count sheets over HTTP (T-166, API_SPEC.md §13, ADR-0173). */
describe('Stock counts (e2e, T-166)', () => {
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

  afterEach(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.stockCount.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'inventory.' } },
          { action: 'http.access-denied' },
        ],
      },
    });
    await app.close();
  });

  const staffWith = (...permissions: AuthenticatedUser['permissions']) =>
    signedInAs({
      id: newId(),
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });

  const http = () => request(app.getHttpServer());
  /** The seller who counts: reads the stock and counts it, blind (ADR-0173). */
  const counter = () => staffWith('inventory.read', 'inventory.count');
  const stocker = () =>
    staffWith('inventory.read', 'inventory.write', 'inventory.count');

  /** A variant with `units` units in the store 204, at a location. */
  async function variant(
    sku: string,
    units: number,
    location: string,
  ): Promise<string> {
    const productId = newId();
    const id = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'The Legend of Zelda',
        slug: `p-${productId}`,
        status: 'PUBLISHED',
        variants: {
          create: { id, sku, options: { n: sku }, status: 'ACTIVE' },
        },
      },
    });
    await http()
      .post(`${INVENTORY}/receipts`)
      .set(stocker())
      .send({ variantId: id, warehouseId: MAIN, quantity: units })
      .expect(201);
    await http()
      .put(`${INVENTORY}/locations`)
      .set(stocker())
      .send({ variantId: id, warehouseId: MAIN, location })
      .expect(200);
    return id;
  }

  const open = (body: Record<string, unknown>) =>
    http()
      .post(COUNTS)
      .set(stocker())
      .send({ warehouseId: MAIN, ...body });

  it('opens a sheet, counts it blind, reviews it and applies it once per Idempotency-Key', async () => {
    const zelda = await variant('ZELDA', 5, 'A1');
    const mario = await variant('MARIO', 2, 'A2');

    const opened = await open({ location: 'a*' }).expect(201);
    expect(opened.headers.location).toBe(`${COUNTS}/${opened.body.id}`);
    expect(opened.body).toMatchObject({
      folio: expect.stringMatching(/^C-\d{6,}$/),
      filter: { location: 'A*' },
      status: 'OPEN',
      blind: false,
      lineCount: 2,
      countedCount: 0,
      version: 1,
    });
    expect(opened.body.lines.map(({ sku }: { sku: string }) => sku)).toEqual([
      'ZELDA',
      'MARIO',
    ]);
    const id: string = opened.body.id;

    const counted = await http()
      .put(`${COUNTS}/${id}/lines/${zelda}`)
      .set(counter())
      .send({ counted: 4 })
      .expect(200);
    expect(counted.body).toMatchObject({
      variantId: zelda,
      sku: 'ZELDA',
      counted: 4,
      expected: null,
      difference: null,
    });
    await http()
      .put(`${COUNTS}/${id}/lines/${mario}`)
      .set(counter())
      .send({ counted: 2 })
      .expect(200);

    const blind = await http()
      .get(`${COUNTS}/${id}`)
      .set(counter())
      .expect(200);
    expect(blind.body.blind).toBe(true);
    expect(blind.body.lines[0]).toMatchObject({
      expected: null,
      difference: null,
    });
    const review = await http()
      .get(`${COUNTS}/${id}`)
      .set(stocker())
      .expect(200);
    expect(review.body).toMatchObject({
      blind: false,
      version: 3,
      countedCount: 2,
    });
    expect(review.body.lines[0]).toMatchObject({
      counted: 4,
      expected: 5,
      difference: -1,
    });

    // The counter neither reviews nor applies.
    await http()
      .post(`${COUNTS}/${id}/apply`)
      .set(counter())
      .set('Idempotency-Key', randomUUID())
      .send({ version: 3 })
      .expect(403);
    await http()
      .post(`${COUNTS}/${id}/apply`)
      .set(stocker())
      .send({ version: 3 })
      .expect(400)
      .expect(({ body }) =>
        expect(body.type).toBe('/problems/idempotency-key-missing'),
      );
    const user = stocker();
    const key = randomUUID();
    const applied = await http()
      .post(`${COUNTS}/${id}/apply`)
      .set(user)
      .set('Idempotency-Key', key)
      .send({ version: 3 })
      .expect(200);
    expect(applied.body).toMatchObject({ status: 'APPLIED', version: 4 });
    const again = await http()
      .post(`${COUNTS}/${id}/apply`)
      .set(user)
      .set('Idempotency-Key', key)
      .send({ version: 3 })
      .expect(200);
    expect(again.body).toEqual(applied.body);
    const line = applied.body.lines.find(
      ({ sku }: { sku: string }) => sku === 'ZELDA',
    );
    expect(line).toMatchObject({ outcome: 'ADJUSTED' });

    // The movement names its sheet.
    const item = await prisma.stockItem.findFirstOrThrow({
      where: { variantId: zelda, warehouseId: MAIN },
    });
    expect(item.onHand).toBe(4);
    const movements = await http()
      .get(`${INVENTORY}/stock-items/${item.id}/movements`)
      .set(stocker())
      .expect(200);
    expect(movements.body.data[0]).toMatchObject({
      id: line.movementId,
      type: 'ADJUSTMENT',
      reasonCode: 'PHYSICAL_COUNT',
      quantity: -1,
      countId: id,
    });

    await http()
      .put(`${COUNTS}/${id}/lines/${zelda}`)
      .set(counter())
      .send({ counted: 1 })
      .expect(409)
      .expect(({ body }) =>
        expect(body.type).toBe('/problems/invalid-state-transition'),
      );
  });

  it('answers a variant in another open sheet, bad filters and counts, and lists the sheets', async () => {
    const zelda = await variant('ZELDA', 5, 'A1');
    const first = await open({ variantIds: [zelda] }).expect(201);

    await open({ location: 'A1' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.type).toBe('/problems/variant-in-open-count');
        expect(body.lines).toEqual([
          { variantId: zelda, countId: first.body.id, folio: first.body.folio },
        ]);
      });
    await open({ variantIds: [zelda], countClass: 'A' })
      .expect(400)
      .expect(({ body }) =>
        expect(body.errors).toEqual([
          expect.objectContaining({
            field: 'variantIds',
            code: 'variantIdsAlone',
          }),
        ]),
      );
    await open({})
      .expect(400)
      .expect(({ body }) =>
        expect(body.errors).toEqual([
          expect.objectContaining({ field: 'location', code: 'countFilter' }),
        ]),
      );
    await open({ location: 'Z9' })
      .expect(400)
      .expect(({ body }) =>
        expect(body.errors).toEqual([
          expect.objectContaining({ field: 'location', code: 'noLines' }),
        ]),
      );
    await open({ countClass: 'D' }).expect(400);
    await http()
      .put(`${COUNTS}/${first.body.id}/lines/${zelda}`)
      .set(counter())
      .send({ counted: 100_001 })
      .expect(400);
    await http()
      .put(`${COUNTS}/${first.body.id}/lines/${newId()}`)
      .set(counter())
      .send({ counted: 1 })
      .expect(404);
    await http().get(`${COUNTS}/not-a-uuid`).set(counter()).expect(404);

    await http()
      .post(`${COUNTS}/${first.body.id}/cancel`)
      .set(stocker())
      .send({ version: 2 })
      .expect(409)
      .expect(({ body }) => expect(body.currentVersion).toBe(1));
    await http()
      .post(`${COUNTS}/${first.body.id}/cancel`)
      .set(stocker())
      .send({ version: 1 })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('CANCELLED'));

    const list = await http()
      .get(COUNTS)
      .query({ status: 'CANCELLED', warehouseId: MAIN })
      .set(counter())
      .expect(200);
    expect(list.body).toMatchObject({
      data: [
        {
          id: first.body.id,
          folio: first.body.folio,
          filter: { variantIds: [zelda] },
          lineCount: 1,
          countedCount: 0,
        },
      ],
      meta: { totalItems: 1 },
    });
    expect(list.body.data[0]).not.toHaveProperty('lines');
  });
});
