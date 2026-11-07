import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId, type PermissionCode } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const PRODUCTS = '/v1/admin/catalog/products';
const OPEN_PRICE_LINES = '/v1/admin/orders/open-price-lines';

/** Selling at the counter what is not in the catalog yet, at the price the staff types, over HTTP (T-182, ADR-0171). */
describe('Open price (e2e, T-182)', () => {
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
    await app.get(DomainEventDispatcher).whenIdle();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'products.' } },
          { action: { startsWith: 'orders.' } },
        ],
      },
    });
    await prisma.stockMovement.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
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
  const editor = staff('catalog.read', 'catalog.write');
  /** As the seeded Vendedor role, with the permission of ADR-0171. */
  const seller = staff(
    'catalog.read',
    'inventory.read',
    'orders.read',
    'orders.place',
    'orders.open-price',
    'customers.read',
  );
  /** The Vendedor once the owner takes the open price from it. */
  const plainSeller = staff('catalog.read', 'orders.read', 'orders.place');

  /**
   * A published product with one variant and 100,000 units in the main warehouse: sold at an open price, without a
   * price in the list, or at $350.00.
   */
  async function product(openPrice: boolean): Promise<string> {
    const id = newId();
    const variantId = newId();
    await prisma.product.create({
      data: {
        id,
        title: openPrice ? 'Artículo sin registrar' : 'Control inalámbrico',
        slug: `producto-${id.slice(-12)}`,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        storeOnly: openPrice,
        openPrice,
        variants: {
          create: {
            id: variantId,
            sku: `SKU-${variantId.slice(-12)}`.toUpperCase(),
            options: {},
            status: 'ACTIVE',
          },
        },
      },
    });
    if (!openPrice) {
      await prisma.variantPrice.create({
        data: {
          id: newId(),
          priceListId: DEFAULT_LIST,
          variantId,
          periods: {
            create: {
              id: newId(),
              amount: 35_000,
              effectiveFrom: new Date(Date.now() - 86_400_000),
              createdBy: newId(),
            },
          },
        },
      });
    }
    await prisma.stockItem.create({
      data: { id: newId(), variantId, warehouseId: MAIN, onHand: 100_000 },
    });
    return variantId;
  }

  const counter = (lines: object[]) => ({
    lines,
    warehouseId: MAIN,
    fulfillment: 'IN_STORE',
  });

  describe('the administration', () => {
    it('marks a product sold only in the store with an open price, lists it with the filter and audits it', async () => {
      const { body: created } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({
          title: 'Artículo sin registrar',
          storeOnly: true,
          openPrice: true,
        })
        .expect(201);
      const { body: other } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({ title: 'Revisión de equipo', storeOnly: true })
        .expect(201);

      expect([created.openPrice, other.openPrice]).toEqual([true, false]);
      const changed = await http()
        .patch(`${PRODUCTS}/${other.id}`)
        .set(signedInAs(editor))
        .send({ openPrice: true, version: other.version })
        .expect(200);
      expect(changed.body).toMatchObject({ openPrice: true, version: 2 });
      const listOf = async (query: string) =>
        (
          await http()
            .get(`${PRODUCTS}?${query}`)
            .set(signedInAs(editor))
            .expect(200)
        ).body.data.map(({ id }: { id: string }) => id);
      expect(await listOf('openPrice=true')).toHaveLength(2);
      // Both off in one request: the open price goes first.
      await http()
        .patch(`${PRODUCTS}/${other.id}`)
        .set(signedInAs(editor))
        .send({ storeOnly: false, openPrice: false, version: 2 })
        .expect(200);
      expect(await listOf('openPrice=true')).toEqual([created.id]);
      expect(await listOf('openPrice=false')).toEqual([other.id]);
      const audits = await prisma.auditLog.findMany({
        where: { action: 'products.update', resourceId: other.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audits.map(({ changes }) => changes)).toEqual([
        { openPrice: { from: false, to: true } },
        {
          openPrice: { from: true, to: false },
          storeOnly: { from: true, to: false },
        },
      ]);
    });

    it('answers an open price on a product sold online too as 400 on openPrice, when creating or changing', async () => {
      const { body: online } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({ title: 'Camisa de lino' })
        .expect(201);
      const { body: open } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({
          title: 'Artículo sin registrar',
          storeOnly: true,
          openPrice: true,
        })
        .expect(201);

      const answers = [
        await http()
          .post(PRODUCTS)
          .set(signedInAs(editor))
          .send({ title: 'Artículo sin registrar', openPrice: true })
          .expect(400),
        await http()
          .patch(`${PRODUCTS}/${online.id}`)
          .set(signedInAs(editor))
          .send({ openPrice: true, version: online.version })
          .expect(400),
        await http()
          .patch(`${PRODUCTS}/${open.id}`)
          .set(signedInAs(editor))
          .send({ storeOnly: false, version: open.version })
          .expect(400),
      ];

      for (const { body } of answers) {
        expect(body.errors).toEqual([
          expect.objectContaining({
            field: 'openPrice',
            code: 'openPriceStoreOnly',
          }),
        ]);
      }
      expect(await prisma.product.count({ where: { openPrice: true } })).toBe(
        1,
      );
    });
  });

  describe('the counter', () => {
    it('quotes and sells a line at the price the staff typed, keeps its note and lists it', async () => {
      const misc = await product(true);
      const controller = await product(false);
      const sale = counter([
        { variantId: controller, quantity: 1 },
        {
          variantId: misc,
          quantity: 2,
          unitPrice: 25_000,
          note: 'Juego usado de carreras',
        },
      ]);

      const { body: quote } = await http()
        .post('/v1/admin/orders/quote')
        .set(signedInAs(seller))
        .send(sale)
        .expect(200);
      const { body: placed } = await http()
        .post('/v1/admin/orders')
        .set(signedInAs(seller))
        .set('Idempotency-Key', randomUUID())
        .send({ ...sale, expectedTotal: 85_000 })
        .expect(201);

      expect(quote).toMatchObject({
        lines: [
          { variantId: controller, note: null },
          {
            variantId: misc,
            unitPrice: { amount: 25_000 },
            lineTotal: { amount: 50_000 },
            note: 'Juego usado de carreras',
            sellable: true,
          },
        ],
        grandTotal: { amount: 85_000 },
        readyToPlace: true,
      });
      expect(placed.lines).toEqual([
        expect.objectContaining({
          productName: 'Control inalámbrico',
          note: null,
        }),
        expect.objectContaining({
          productName: 'Artículo sin registrar',
          unitPrice: { amount: 25_000, currency: 'MXN' },
          quantity: 2,
          note: 'Juego usado de carreras',
        }),
      ]);
      const { body: listed } = await http()
        .get(`${OPEN_PRICE_LINES}?warehouseId=${MAIN}`)
        .set(signedInAs(seller))
        .expect(200);
      expect(listed).toMatchObject({
        data: [
          {
            orderId: placed.id,
            publicCode: placed.publicCode,
            status: 'PENDING_PAYMENT',
            warehouseId: MAIN,
            placedBy: seller.id,
            lineNumber: 2,
            productName: 'Artículo sin registrar',
            unitPrice: { amount: 25_000 },
            quantity: 2,
            lineTotal: { amount: 50_000 },
            note: 'Juego usado de carreras',
          },
        ],
        meta: { totalItems: 1 },
      });
      const elsewhere = await http()
        .get(`${OPEN_PRICE_LINES}?warehouseId=${newId()}&placedFrom=2026-01-01`)
        .set(signedInAs(seller))
        .expect(200);
      expect(elsewhere.body.data).toEqual([]);
    });

    it('needs the price and the note on a line at an open price, and rejects them on the others', async () => {
      const misc = await product(true);
      const controller = await product(false);

      const cases = [
        [{ variantId: misc, quantity: 1, note: 'Juego' }, 'lines[0].unitPrice'],
        [{ variantId: misc, quantity: 1, unitPrice: 100 }, 'lines[0].note'],
        [
          { variantId: controller, quantity: 1, unitPrice: 100 },
          'lines[0].unitPrice',
        ],
        [
          {
            variantId: misc,
            quantity: 1,
            unitPrice: 10_000_001,
            note: 'Consola',
          },
          'lines[0].unitPrice',
        ],
        [
          {
            variantId: misc,
            quantity: 1,
            unitPrice: 100,
            note: 'x'.repeat(201),
          },
          'lines[0].note',
        ],
      ] as const;
      for (const [line, field] of cases) {
        const { body } = await http()
          .post('/v1/admin/orders/quote')
          .set(signedInAs(seller))
          .send(counter([line]))
          .expect(400);
        expect(body.errors).toEqual([expect.objectContaining({ field })]);
      }
    });

    it('needs orders.open-price, placing nothing without it', async () => {
      const misc = await product(true);
      const sale = counter([
        { variantId: misc, quantity: 1, unitPrice: 15_000, note: 'Cable' },
      ]);

      await http()
        .post('/v1/admin/orders/quote')
        .set(signedInAs(plainSeller))
        .send(sale)
        .expect(403);
      await http()
        .post('/v1/admin/orders')
        .set(signedInAs(plainSeller))
        .set('Idempotency-Key', randomUUID())
        .send({ ...sale, expectedTotal: 15_000 })
        .expect(403);

      expect(await prisma.order.count()).toBe(0);
      await http().get(OPEN_PRICE_LINES).set(signedInAs(editor)).expect(403);
    });
  });
});
