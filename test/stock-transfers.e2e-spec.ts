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
    // The returns of the loans first, which name them.
    await prisma.stockTransfer.deleteMany({ where: { loanId: { not: null } } });
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
      kind: 'TRANSFER',
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
          returned: null,
        },
      ],
      createdBy: staffId,
      createdAt: expect.any(String),
      cancellableUntil: new Date(
        Date.parse(created.body.createdAt) + 10 * 60_000,
      ).toISOString(),
      cancelledBy: null,
      cancelledAt: null,
      returnBy: null,
      overdue: false,
      closedBy: null,
      closedAt: null,
      loanId: null,
      returnTransferId: null,
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
    [{ reason: 'LOAN_RETURN' }, 'reason', 'isIn'],
    [{ reason: 'SHOW' }, 'reason', 'reasonKind'],
    [{ kind: 'LOAN' }, 'reason', 'reasonKind'],
    [{ kind: 'LOAN', reason: 'SHOW' }, 'returnBy', 'loanRange'],
    [
      { kind: 'LOAN', reason: 'SHOW', returnBy: '2020-01-01T00:00:00.000Z' },
      'returnBy',
      'loanRange',
    ],
    [
      { reason: 'SALE', returnBy: '2099-01-01T00:00:00.000Z' },
      'returnBy',
      'isEmpty',
    ],
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

  describe('loans (T-164)', () => {
    const lend = (variantId: string, quantity: number, minutes = 60) =>
      transfer({
        kind: 'LOAN',
        reason: 'SHOW',
        returnBy: new Date(Date.now() + minutes * 60_000).toISOString(),
        lines: [{ variantId, quantity }],
      });

    it('lends to show, lists the open and overdue loans, and closes with what came back', async () => {
      const zelda = await variant('JUE-ZELDA-SW', 5);
      const loan = await lend(zelda, 2).expect(201);
      const overdue = await lend(zelda, 1).expect(201);
      // It was recorded two hours ago, to come back one hour ago.
      await prisma.$executeRaw`
        UPDATE stock_transfers
           SET created_at = now() - interval '2 hours', return_by = now() - interval '1 hour'
         WHERE id = ${overdue.body.id}::uuid`;

      const open = await http()
        .get(`${TRANSFERS}?kind=LOAN&status=OPEN&warehouseId=${other}`)
        .set(reader())
        .expect(200);
      const late = await http()
        .get(`${TRANSFERS}?overdue=true`)
        .set(reader())
        .expect(200);
      const closed = await http()
        .post(`${TRANSFERS}/${loan.body.id}/close`)
        .set(seller())
        .send({ version: 1, lines: [{ variantId: zelda, returned: 1 }] })
        .expect(200);
      const again = await http()
        .post(`${TRANSFERS}/${loan.body.id}/close`)
        .set(seller())
        .send({ version: 2, lines: [{ variantId: zelda, returned: 1 }] })
        .expect(409);
      const back = await http()
        .get(`${TRANSFERS}/${closed.body.returnTransferId}`)
        .set(reader())
        .expect(200);

      expect(loan.body).toMatchObject({
        folio: expect.stringMatching(/^P-\d{6,}$/),
        kind: 'LOAN',
        reason: 'SHOW',
        status: 'OPEN',
        returnBy: expect.any(String),
        overdue: false,
        cancellableUntil: expect.any(String),
      });
      expect(open.body.data.map(({ id }: { id: string }) => id).sort()).toEqual(
        [loan.body.id, overdue.body.id].sort(),
      );
      expect(late.body.data).toEqual([
        expect.objectContaining({ id: overdue.body.id, overdue: true }),
      ]);
      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        closedBy: staffId,
        closedAt: expect.any(String),
        cancellableUntil: null,
        lines: [expect.objectContaining({ quantity: 2, returned: 1 })],
        version: 2,
      });
      expect(again.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'CLOSED',
      });
      expect(back.body).toMatchObject({
        folio: expect.stringMatching(/^T-\d{6,}$/),
        reason: 'LOAN_RETURN',
        fromWarehouseId: other,
        toWarehouseId: MAIN,
        loanId: loan.body.id,
        cancellableUntil: null,
        lines: [expect.objectContaining({ quantity: 1, returned: null })],
      });
      // 5 - 2 - 1 + 1 in the store 204, and 1 + 1 still in the other.
      expect(await stockOf(zelda)).toEqual([3, 2]);
    });

    it('answers 400 for lines that are not the loan, 409 for closing a transfer, and 403 without inventory.transfer', async () => {
      const zelda = await variant('JUE-ZELDA-SW', 5);
      const loan = await lend(zelda, 2).expect(201);
      const moved = await transfer({
        reason: 'SALE',
        lines: [{ variantId: zelda, quantity: 1 }],
      }).expect(201);
      const close = (
        id: string,
        body: Record<string, unknown>,
        as = seller(),
      ) => http().post(`${TRANSFERS}/${id}/close`).set(as).send(body);

      const missing = await close(loan.body.id, {
        version: 1,
        lines: [{ variantId: newId(), returned: 0 }],
      }).expect(400);
      const beyond = await close(loan.body.id, {
        version: 1,
        lines: [{ variantId: zelda, returned: 3 }],
      }).expect(400);
      const notLoan = await close(moved.body.id, {
        version: 1,
        lines: [{ variantId: zelda, returned: 1 }],
      }).expect(409);
      await close(
        loan.body.id,
        { version: 1, lines: [{ variantId: zelda, returned: 2 }] },
        reader(),
      ).expect(403);
      await close(newId(), {
        version: 1,
        lines: [{ variantId: zelda, returned: 2 }],
      }).expect(404);

      expect(missing.body.errors).toEqual([
        expect.objectContaining({
          field: 'lines[0].variantId',
          code: 'loanLines',
        }),
      ]);
      expect(beyond.body.errors).toEqual([
        expect.objectContaining({ field: 'lines[0].returned', code: 'range' }),
      ]);
      expect(notLoan.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'COMPLETED',
      });
    });
  });
});
