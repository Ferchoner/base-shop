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
const TRANSFERS = `${INVENTORY}/transfers`;
/** The warehouse the migration creates (ADR-0127), here the store 204. */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

/** Transfers between warehouses over HTTP (T-163, API_SPEC.md §13, ADR-0172). */
describe('Stock transfers (e2e, T-163)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const staffId = newId();
  let other: string;

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
    other = newId();
    await prisma.warehouse.create({
      data: {
        id: other,
        code: 'LOCAL-206',
        name: 'Local 206',
        status: 'ACTIVE',
        priority: 2,
      },
    });
  });

  afterEach(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.stockTransfer.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'inventory.' } },
          { action: { startsWith: 'warehouses.' } },
          { action: 'http.access-denied' },
        ],
      },
    });
    await app.close();
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
  const reader = () => staffWith('inventory.read');
  /** The seller of a store: reads the stock and moves it, but does not adjust it (ADR-0172). */
  const seller = () => staffWith('inventory.read', 'inventory.transfer');
  const stocker = () => staffWith('inventory.read', 'inventory.write');

  /** A variant with `units` units in the store 204. */
  async function variant(sku: string, units: number): Promise<string> {
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
    return id;
  }

  const transfer = (body: Record<string, unknown>, key = randomUUID()) =>
    http()
      .post(TRANSFERS)
      .set(seller())
      .set('Idempotency-Key', key)
      .send({ fromWarehouseId: MAIN, toWarehouseId: other, ...body });

  const stockOf = async (variantId: string) => {
    const items = await prisma.stockItem.findMany({ where: { variantId } });
    const of = (warehouseId: string) =>
      items.find((item) => item.warehouseId === warehouseId)?.onHand ?? null;
    return [of(MAIN), of(other)];
  };

  it('moves the units with a seller, once per Idempotency-Key, and answers the transfer where it is', async () => {
    const zelda = await variant('JUE-ZELDA-SW', 5);
    const key = randomUUID();
    const body = {
      reason: 'SALE',
      note: 'Para el cliente de la mañana',
      lines: [{ variantId: zelda, quantity: 2 }],
    };

    const created = await transfer(body, key).expect(201);
    const replayed = await transfer(body, key).expect(201);
    const read = await http()
      .get(`${TRANSFERS}/${created.body.id}`)
      .set(reader())
      .expect(200);

    expect(created.headers.location).toBe(`${TRANSFERS}/${created.body.id}`);
    expect(created.body).toEqual({
      id: expect.any(String),
      folio: expect.stringMatching(/^T-\d{6,}$/),
      fromWarehouseId: MAIN,
      toWarehouseId: other,
      reason: 'SALE',
      note: 'Para el cliente de la mañana',
      status: 'COMPLETED',
      lines: [
        {
          variantId: zelda,
          sku: 'JUE-ZELDA-SW',
          productTitle: 'The Legend of Zelda',
          quantity: 2,
        },
      ],
      createdBy: staffId,
      createdAt: expect.any(String),
      cancellableUntil: new Date(
        Date.parse(created.body.createdAt) + 10 * 60_000,
      ).toISOString(),
      cancelledBy: null,
      cancelledAt: null,
      version: 1,
    });
    expect(replayed.body).toEqual(created.body);
    expect(read.body).toEqual(created.body);
    expect(await stockOf(zelda)).toEqual([3, 2]);

    const item = await prisma.stockItem.findFirstOrThrow({
      where: { variantId: zelda, warehouseId: other },
    });
    const movements = await http()
      .get(`${INVENTORY}/stock-items/${item.id}/movements?type=TRANSFER`)
      .set(reader())
      .expect(200);
    expect(movements.body.data).toEqual([
      expect.objectContaining({
        type: 'TRANSFER',
        quantity: 2,
        onHandAfter: 2,
        note: 'Para el cliente de la mañana',
        transferId: created.body.id,
        actorId: staffId,
      }),
    ]);
  });

  it('cancels it in its first 10 minutes, and answers 409 after them or twice', async () => {
    const zelda = await variant('JUE-ZELDA-SW', 5);
    const done = await transfer({
      reason: 'RESTOCK',
      lines: [{ variantId: zelda, quantity: 2 }],
    }).expect(201);
    const late = await transfer({
      reason: 'RESTOCK',
      lines: [{ variantId: zelda, quantity: 1 }],
    }).expect(201);
    await prisma.$executeRaw`
      UPDATE stock_transfers SET created_at = created_at - interval '11 minutes' WHERE id = ${late.body.id}::uuid`;

    const cancelled = await http()
      .post(`${TRANSFERS}/${done.body.id}/cancel`)
      .set(seller())
      .send({ version: 1 })
      .expect(200);
    const twice = await http()
      .post(`${TRANSFERS}/${done.body.id}/cancel`)
      .set(seller())
      .send({ version: 2 })
      .expect(409);
    const passed = await http()
      .post(`${TRANSFERS}/${late.body.id}/cancel`)
      .set(seller())
      .send({ version: 1 })
      .expect(409);
    const stale = await http()
      .post(`${TRANSFERS}/${late.body.id}/cancel`)
      .set(seller())
      .send({ version: 3 })
      .expect(409);

    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancellableUntil: null,
      cancelledBy: staffId,
      cancelledAt: expect.any(String),
      version: 2,
    });
    expect(twice.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'CANCELLED',
    });
    expect(passed.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'COMPLETED',
      reason: 'cancel-window-passed',
    });
    expect(stale.body).toMatchObject({ type: '/problems/version-conflict' });
    expect(await stockOf(zelda)).toEqual([4, 1]);

    const list = await http()
      .get(`${TRANSFERS}?warehouseId=${other}&status=CANCELLED`)
      .set(reader())
      .expect(200);
    expect(list.body).toEqual({
      data: [expect.objectContaining({ id: done.body.id })],
      meta: expect.objectContaining({ totalItems: 1 }),
    });
  });

  it('answers 409 insufficient-stock with the lines that are short, and moves nothing', async () => {
    const zelda = await variant('JUE-ZELDA-SW', 1);
    const mario = await variant('JUE-MARIO-SW', 5);

    const response = await transfer({
      reason: 'SALE',
      lines: [
        { variantId: zelda, quantity: 2 },
        { variantId: mario, quantity: 1 },
      ],
    }).expect(409);

    expect(response.body).toMatchObject({
      type: '/problems/insufficient-stock',
      lines: [{ variantId: zelda, canFulfill: false }],
    });
    expect(await stockOf(zelda)).toEqual([1, null]);
    expect(await stockOf(mario)).toEqual([5, null]);
    expect(await prisma.stockTransfer.count()).toBe(0);
  });

  it.each([
    [{ toWarehouseId: MAIN }, 'toWarehouseId', 'differentWarehouse'],
    [{ reason: 'OTHER' }, 'note', 'isNotEmpty'],
    [{ reason: 'LOAN' }, 'reason', 'isIn'],
    [{ lines: [] }, 'lines', 'arrayMinSize'],
    [{ lines: [{ quantity: 0 }] }, 'lines[0].quantity', 'min'],
    [{ lines: [{}, {}] }, 'lines[1].variantId', 'duplicateVariant'],
  ])('answers 400 for the transfer %j', async (change, field, code) => {
    const zelda = await variant('JUE-ZELDA-SW', 5);
    const lines = (
      (change as { lines?: Record<string, unknown>[] }).lines ?? [{}]
    ).map((line) => ({ variantId: zelda, quantity: 1, ...line }));

    const response = await transfer({
      reason: 'SALE',
      ...change,
      lines,
    }).expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field, code }),
    ]);
  });

  it('answers 404 for a missing variant, transfer or warehouse, or an inactive destination, and 403 without inventory.transfer', async () => {
    const zelda = await variant('JUE-ZELDA-SW', 5);
    const line = [{ variantId: zelda, quantity: 1 }];

    await transfer({
      reason: 'SALE',
      lines: [{ variantId: newId(), quantity: 1 }],
    }).expect(404);
    await transfer({
      reason: 'SALE',
      toWarehouseId: newId(),
      lines: line,
    }).expect(404);
    await prisma.warehouse.update({
      where: { id: other },
      data: { status: 'INACTIVE' },
    });
    await transfer({ reason: 'SALE', lines: line }).expect(404);
    await http().get(`${TRANSFERS}/${newId()}`).set(reader()).expect(404);
    await http()
      .post(`${TRANSFERS}/${newId()}/cancel`)
      .set(seller())
      .send({ version: 1 })
      .expect(404);
    await http()
      .post(TRANSFERS)
      .set(stocker())
      .set('Idempotency-Key', randomUUID())
      .send({
        fromWarehouseId: MAIN,
        toWarehouseId: other,
        reason: 'SALE',
        lines: line,
      })
      .expect(403);
    await http()
      .post(TRANSFERS)
      .set(seller())
      .send({
        fromWarehouseId: MAIN,
        toWarehouseId: other,
        reason: 'SALE',
        lines: line,
      })
      .expect(400);
    expect(await prisma.stockTransfer.count()).toBe(0);
  });
});
