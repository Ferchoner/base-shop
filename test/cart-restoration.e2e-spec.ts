import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { OrderExpiry } from '../src/modules/ordering/application/order-expiry.use-case.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

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

/** The cart comes back when an order expires (e2e, T-181 part a, UC-CRT-08, ADR-0054, ADR-0137). */
describe('Cart of an expired order (e2e, T-181)', () => {
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
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany({
      where: { mergedIntoCartId: { not: null } },
    });
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** The order's payment is due, the expiration job ends it, and its event is handled (ADR-0136). */
  async function expire(orderId: string): Promise<void> {
    await prisma.order.update({
      where: { id: orderId },
      data: { paymentDueAt: new Date(Date.now() - 1_000) },
    });
    await app.get(ClsService).run(() => app.get(OrderExpiry).expireDue());
    await app.get(DomainEventDispatcher).whenIdle();
  }

  /** A published variant priced at $100.00, with 10 units. */
  async function variant(): Promise<string> {
    const productId = newId();
    const id = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug: `camisa-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id,
            sku: `CAM-${id.slice(-12)}`.toUpperCase(),
            options: { talla: 'M' },
            status: 'ACTIVE',
          },
        },
      },
    });
    await prisma.variantPrice.create({
      data: {
        id: newId(),
        priceListId: DEFAULT_LIST,
        variantId: id,
        periods: {
          create: {
            id: newId(),
            amount: 10_000,
            effectiveFrom: new Date(Date.now() - 86_400_000),
            createdBy: newId(),
          },
        },
      },
    });
    await prisma.stockItem.create({
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: 10 },
    });
    return id;
  }

  /** A verified customer. */
  async function customer(): Promise<AuthenticatedUser> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: new Date(),
      },
    });
    return {
      id,
      type: 'CUSTOMER',
      permissions: [],
      mustChangePassword: false,
      sessionId: newId(),
    };
  }

  /** Adds a line to the customer's cart: 201 when it opens the cart, 200 when the cart exists. */
  const addToMyCart = (
    user: AuthenticatedUser,
    variantId: string,
    quantity = 1,
    status = 201,
  ) =>
    http()
      .post('/v1/me/cart/lines')
      .set(signedInAs(user))
      .send({ variantId, quantity })
      .expect(status);

  /** The customer orders what is in the cart. */
  async function customerOrder(
    user: AuthenticatedUser,
    expectedTotal: number,
  ): Promise<string> {
    const { body } = await http()
      .post('/v1/me/orders')
      .set(signedInAs(user))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal })
      .expect(201);
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: (body.publicCode as string).replace('-', '') },
    });
    return id;
  }

  const myCart = (user: AuthenticatedUser) =>
    http().get('/v1/me/cart').set(signedInAs(user)).expect(200);

  const quantities = (body: {
    lines: { variantId: string; quantity: number }[];
  }) => body.lines.map(({ variantId, quantity }) => [variantId, quantity]);

  it('gives a guest the cart of the order back, which can be changed and ordered again', async () => {
    const shirt = await variant();
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId: shirt, quantity: 2 })
      .expect(200);
    const { body: placed } = await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        expectedTotal: 29_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: (placed.publicCode as string).replace('-', '') },
    });
    expect(
      (await http().get(`/v1/carts/${cartId}`).expect(200)).body.status,
    ).toBe('CHECKED_OUT');

    await expire(id);

    const { body } = await http().get(`/v1/carts/${cartId}`).expect(200);
    expect(body).toMatchObject({ id: cartId, status: 'ACTIVE' });
    expect(quantities(body)).toEqual([[shirt, 2]]);
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId: shirt, quantity: 1 })
      .expect(200);
    await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        expectedTotal: 39_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
  });

  it('gives a customer without an active cart the cart of the order back', async () => {
    const shirt = await variant();
    const user = await customer();
    await addToMyCart(user, shirt, 2);
    const cartId = (await myCart(user)).body.id as string;
    const id = await customerOrder(user, 29_900);

    await expire(id);

    const { body } = await myCart(user);
    expect(body).toMatchObject({ id: cartId, status: 'ACTIVE' });
    expect(quantities(body)).toEqual([[shirt, 2]]);
  });

  it('adds the lines of the order to the cart the customer started meanwhile, up to 30 units', async () => {
    const [shirt, cap] = [await variant(), await variant()];
    const user = await customer();
    await addToMyCart(user, shirt, 2);
    const ordered = (await myCart(user)).body.id as string;
    const id = await customerOrder(user, 29_900);
    await addToMyCart(user, cap, 1);
    await addToMyCart(user, shirt, 29, 200);
    const started = (await myCart(user)).body.id as string;

    await expire(id);

    const { body } = await myCart(user);
    expect(body.id).toBe(started);
    expect(quantities(body)).toEqual([
      [cap, 1],
      [shirt, 30],
    ]);
    expect(
      await prisma.cart.findUniqueOrThrow({ where: { id: ordered } }),
    ).toMatchObject({ status: 'MERGED', mergedIntoCartId: started });
  });
});
