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

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

/** Products sold only in the physical store, such as services, over HTTP (T-189 part a, UC-CAT-17, ADR-0165). */
describe('Products sold only in the store (e2e, T-189 part a)', () => {
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
    await prisma.geoState.upsert({
      where: { code: '16' },
      create: { code: '16', name: 'Michoacán de Ocampo' },
      update: {},
    });
    await prisma.geoMunicipality.upsert({
      where: { code: '16053' },
      create: {
        code: '16053',
        stateCode: '16',
        name: 'Morelia',
        isActive: true,
      },
      update: {},
    });
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
    await prisma.paymentAttempt.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
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
  const idle = () => app.get(DomainEventDispatcher).whenIdle();

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const editor = staff('catalog.read', 'catalog.write');
  /** As the seeded Vendedor role (ADR-0161). */
  const seller = staff(
    'catalog.read',
    'inventory.read',
    'orders.read',
    'orders.place',
    'customers.read',
  );

  /** A published product with one variant priced at $350.00 and 100,000 units in the main warehouse. */
  async function product(
    storeOnly: boolean,
  ): Promise<{ id: string; slug: string; variantId: string }> {
    const id = newId();
    const variantId = newId();
    const slug = `revision-${id.slice(-12)}`;
    await prisma.product.create({
      data: {
        id,
        title: 'Revisión de equipo',
        slug,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
        storeOnly,
        variants: {
          create: {
            id: variantId,
            sku: `SERV-${variantId.slice(-12)}`.toUpperCase(),
            options: {},
            status: 'ACTIVE',
          },
        },
      },
    });
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
    await prisma.stockItem.create({
      data: { id: newId(), variantId, warehouseId: MAIN, onHand: 100_000 },
    });
    return { id, slug, variantId };
  }

  /** Sells the product only in the store, or online too, with its current version. */
  const markStoreOnly = async (id: string, storeOnly: boolean) => {
    const { version } = await prisma.product.findUniqueOrThrow({
      where: { id },
    });
    await http()
      .patch(`${PRODUCTS}/${id}`)
      .set(signedInAs(editor))
      .send({ storeOnly, version })
      .expect(200);
  };

  const storeSlugs = async () =>
    (
      (await http().get('/v1/catalog/products').expect(200)).body.data as {
        slug: string;
      }[]
    ).map(({ slug }) => slug);

  async function guestCart(variantId: string): Promise<string> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId, quantity: 1 })
      .expect(200);
    return cartId;
  }

  describe('the administration', () => {
    it('creates a product sold only in the store, changes it either way and lists it with the filter', async () => {
      const { body: created } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({ title: 'Instalación de software', storeOnly: true })
        .expect(201);
      const { body: online } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({ title: 'Camisa de lino' })
        .expect(201);

      expect([created.storeOnly, online.storeOnly]).toEqual([true, false]);
      const changed = await http()
        .patch(`${PRODUCTS}/${online.id}`)
        .set(signedInAs(editor))
        .send({ storeOnly: true, version: online.version })
        .expect(200);
      expect(changed.body).toMatchObject({ storeOnly: true, version: 2 });
      const listOf = async (query: string) =>
        (
          await http()
            .get(`${PRODUCTS}?${query}`)
            .set(signedInAs(editor))
            .expect(200)
        ).body.data.map(({ id }: { id: string }) => id);
      expect(await listOf('storeOnly=true')).toHaveLength(2);
      await markStoreOnly(online.id, false);
      expect(await listOf('storeOnly=true')).toEqual([created.id]);
      expect(await listOf('storeOnly=false')).toEqual([online.id]);
      await http()
        .get(`${PRODUCTS}?storeOnly=si`)
        .set(signedInAs(editor))
        .expect(400);
      const audits = await prisma.auditLog.findMany({
        where: { action: 'products.update', resourceId: online.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audits.map(({ changes }) => changes)).toEqual([
        { storeOnly: { from: false, to: true } },
        { storeOnly: { from: true, to: false } },
      ]);
    });

    it('answers a storeOnly that is not a boolean, when creating or changing, as 400 on its field', async () => {
      const { body: created } = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({ title: 'Camisa de lino' })
        .expect(201);

      const create = await http()
        .post(PRODUCTS)
        .set(signedInAs(editor))
        .send({ title: 'Instalación de software', storeOnly: 'true' })
        .expect(400);
      const change = await http()
        .patch(`${PRODUCTS}/${created.id}`)
        .set(signedInAs(editor))
        .send({ storeOnly: 'sí', version: created.version })
        .expect(400);

      for (const { body } of [create, change]) {
        expect(body.errors).toEqual([
          expect.objectContaining({ field: 'storeOnly' }),
        ]);
      }
    });

    it('says a published product sold only in the store is so, not hidden for want of a price', async () => {
      const service = await product(true);

      const { body } = await http()
        .get(`${PRODUCTS}/${service.id}`)
        .set(signedInAs(editor))
        .expect(200);

      expect(body).toMatchObject({
        storeOnly: true,
        storeVisibility: 'STORE_ONLY',
      });
    });
  });

  describe('the online store', () => {
    it('does not show it, and shows it again, at once, when it is sold online', async () => {
      const service = await product(false);
      expect(await storeSlugs()).toEqual([service.slug]);

      await markStoreOnly(service.id, true);
      await idle();

      expect(await storeSlugs()).toEqual([]);
      await http().get(`/v1/catalog/products/${service.slug}`).expect(404);

      await markStoreOnly(service.id, false);
      await idle();
      expect(await storeSlugs()).toEqual([service.slug]);
      await http().get(`/v1/catalog/products/${service.slug}`).expect(200);
    });

    it('does not add it to a cart, and leaves it out of a cart that had it', async () => {
      const service = await product(false);
      const cartId = await guestCart(service.variantId);
      await markStoreOnly(service.id, true);

      const empty = (await http().post('/v1/carts').expect(201)).body
        .id as string;
      const added = await http()
        .post(`/v1/carts/${empty}/lines`)
        .send({ variantId: service.variantId, quantity: 1 })
        .expect(409);
      const { body: cart } = await http()
        .get(`/v1/carts/${cartId}`)
        .expect(200);

      expect(added.body).toMatchObject({
        type: '/problems/variant-not-sellable',
        variantIds: [service.variantId],
      });
      expect(cart).toMatchObject({
        lines: [
          expect.objectContaining({
            variantId: service.variantId,
            sellable: false,
          }),
        ],
        subtotal: { amount: 0 },
      });
    });

    it('does not quote nor place it in an online order', async () => {
      const service = await product(false);
      const cartId = await guestCart(service.variantId);
      await markStoreOnly(service.id, true);

      const { body: quote } = await http()
        .post('/v1/checkout/quote')
        .send({ cartId })
        .expect(200);
      const placed = await http()
        .post('/v1/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          cartId,
          contactEmail: 'cliente@example.com',
          shippingAddress: ADDRESS,
          expectedTotal: 44_900,
          privacyNoticeVersion: '2026-09',
        })
        .expect(409);

      expect(quote).toMatchObject({
        lines: [{ variantId: service.variantId, sellable: false }],
        readyToPlace: false,
      });
      expect(placed.body).toMatchObject({
        type: '/problems/variant-not-sellable',
        variantIds: [service.variantId],
      });
      expect(await prisma.order.count()).toBe(0);
    });
  });

  describe('the physical store', () => {
    it('sells it at the counter', async () => {
      const service = await product(true);
      const sale = {
        lines: [{ variantId: service.variantId, quantity: 1 }],
        warehouseId: MAIN,
        fulfillment: 'IN_STORE',
      };

      const { body: quote } = await http()
        .post('/v1/admin/orders/quote')
        .set(signedInAs(seller))
        .send(sale)
        .expect(200);
      const { body: placed } = await http()
        .post('/v1/admin/orders')
        .set(signedInAs(seller))
        .set('Idempotency-Key', randomUUID())
        .send({ ...sale, expectedTotal: 35_000 })
        .expect(201);

      expect(quote).toMatchObject({
        lines: [{ variantId: service.variantId, sellable: true }],
        readyToPlace: true,
      });
      expect(placed).toMatchObject({
        channel: 'STORE',
        grandTotal: { amount: 35_000 },
        lines: [
          expect.objectContaining({
            productName: 'Revisión de equipo',
            quantity: 1,
          }),
        ],
      });
    });
  });
});
