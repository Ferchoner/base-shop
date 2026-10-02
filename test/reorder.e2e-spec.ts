import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
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

/** Buying a cancelled order again (e2e, T-181 part b, UC-CRT-09, ADR-0055, ADR-0082, ADR-0139). */
describe('Reorder (e2e, T-181)', () => {
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
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'orders.' } },
    });
    await prisma.paymentAttempt.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.cartLine.deleteMany();
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

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const manager = staff('orders.read', 'orders.manage');

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

  /** The variant is no longer sold. */
  const discontinue = (id: string) =>
    prisma.productVariant.update({
      where: { id },
      data: { status: 'DISCONTINUED' },
    });

  const total = (lines: { quantity: number }[]) =>
    lines.reduce((sum, { quantity }) => sum + quantity * 10_000, 9_900);

  /** A guest order of these lines, placed with `cliente@example.com`. */
  async function guestOrder(
    lines: { variantId: string; quantity: number }[],
  ): Promise<{ id: string; publicCode: string; cartId: string }> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    for (const line of lines) {
      await http().post(`/v1/carts/${cartId}/lines`).send(line).expect(200);
    }
    const { body } = await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        expectedTotal: total(lines),
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: (body.publicCode as string).replace('-', '') },
    });
    return { id, publicCode: body.publicCode as string, cartId };
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
    quantity: number,
    status = 201,
  ) =>
    http()
      .post('/v1/me/cart/lines')
      .set(signedInAs(user))
      .send({ variantId, quantity })
      .expect(status);

  /** The customer orders these lines, which open a new cart. */
  async function customerOrder(
    user: AuthenticatedUser,
    lines: { variantId: string; quantity: number }[],
  ): Promise<{ id: string; publicCode: string }> {
    for (const [index, { variantId, quantity }] of lines.entries()) {
      await addToMyCart(user, variantId, quantity, index === 0 ? 201 : 200);
    }
    const { body } = await http()
      .post('/v1/me/orders')
      .set(signedInAs(user))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal: total(lines) })
      .expect(201);
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: (body.publicCode as string).replace('-', '') },
    });
    return { id, publicCode: body.publicCode as string };
  }

  const cancel = (orderId: string) =>
    http()
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version: 1 })
      .expect(200);

  const quantities = (lines: { variantId: string; quantity: number }[]) =>
    lines.map(({ variantId, quantity }) => [variantId, quantity]);

  const guestCart = async (cartId: string) =>
    (await http().get(`/v1/carts/${cartId}`).expect(200)).body as {
      status: string;
      lines: { variantId: string; quantity: number }[];
    };

  describe('a customer (POST /v1/me/orders/{publicCode}/reorder)', () => {
    const reorder = (user: AuthenticatedUser, publicCode: string) =>
      http().post(`/v1/me/orders/${publicCode}/reorder`).set(signedInAs(user));

    it('copies the lines still sold into the active cart, up to 30 units, and the order does not change', async () => {
      const [shirt, cap] = [await variant(), await variant()];
      const user = await customer();
      const order = await customerOrder(user, [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ]);
      await cancel(order.id);
      await discontinue(cap);
      await addToMyCart(user, shirt, 29);
      const active = (
        await http().get('/v1/me/cart').set(signedInAs(user)).expect(200)
      ).body.id as string;

      const { body } = await reorder(
        user,
        order.publicCode.toLowerCase(),
      ).expect(200);

      expect(body).toEqual({ cartId: active, skippedVariantIds: [cap] });
      const cart = await http()
        .get('/v1/me/cart')
        .set(signedInAs(user))
        .expect(200);
      expect(quantities(cart.body.lines)).toEqual([[shirt, 30]]);
      expect(
        await prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).toMatchObject({ status: 'CANCELLED', version: 2 });
    });

    it('opens a cart for a customer without one', async () => {
      const shirt = await variant();
      const user = await customer();
      const order = await customerOrder(user, [
        { variantId: shirt, quantity: 2 },
      ]);
      await cancel(order.id);

      const { body } = await reorder(user, order.publicCode).expect(200);

      const cart = await http()
        .get('/v1/me/cart')
        .set(signedInAs(user))
        .expect(200);
      expect(cart.body).toMatchObject({ id: body.cartId, status: 'ACTIVE' });
      expect(quantities(cart.body.lines)).toEqual([[shirt, 2]]);
    });

    it('answers 409 for an order not cancelled nor refunded, 404 for another customer’s, and 403 to the staff', async () => {
      const shirt = await variant();
      const user = await customer();
      const pending = await customerOrder(user, [
        { variantId: shirt, quantity: 1 },
      ]);

      const conflict = await reorder(user, pending.publicCode).expect(409);
      await reorder(await customer(), pending.publicCode).expect(404);
      await reorder(user, 'no-es-un-codigo').expect(404);
      const forbidden = await reorder(manager, pending.publicCode).expect(403);

      expect(conflict.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'PENDING_PAYMENT',
      });
      expect(forbidden.body.type).toBe('/problems/staff-cannot-purchase');
    });
  });

  describe('a guest (POST /v1/orders/reorder)', () => {
    const reorder = (body: object, user?: AuthenticatedUser) => {
      const call = http().post('/v1/orders/reorder');
      return (user === undefined ? call : call.set(signedInAs(user))).send(
        body,
      );
    };

    it('copies the order into a new guest cart, or into the active guest cart given', async () => {
      const shirt = await variant();
      const order = await guestOrder([{ variantId: shirt, quantity: 2 }]);
      await cancel(order.id);
      const given = (await http().post('/v1/carts').expect(201)).body
        .id as string;

      const fresh = await reorder({
        contactEmail: ' Cliente@Example.COM ',
        publicCode: order.publicCode,
      }).expect(200);
      const into = await reorder({
        contactEmail: 'cliente@example.com',
        publicCode: order.publicCode,
        cartId: given,
      }).expect(200);

      expect(fresh.body.cartId).not.toBe(order.cartId);
      expect(into.body).toEqual({ cartId: given, skippedVariantIds: [] });
      for (const cartId of [fresh.body.cartId as string, given]) {
        const cart = await guestCart(cartId);
        expect(cart.status).toBe('ACTIVE');
        expect(quantities(cart.lines)).toEqual([[shirt, 2]]);
      }
    });

    it('answers the 404 of the lookup, 409 for an order not cancelled, and the errors of the cart given', async () => {
      const shirt = await variant();
      const pending = await guestOrder([{ variantId: shirt, quantity: 1 }]);
      const cancelled = await guestOrder([{ variantId: shirt, quantity: 1 }]);
      await cancel(cancelled.id);
      const as = (changes: object) => ({
        contactEmail: 'cliente@example.com',
        publicCode: cancelled.publicCode,
        ...changes,
      });

      const missing = await reorder(
        as({ contactEmail: 'otro@example.com' }),
      ).expect(404);
      const lookup = await http()
        .post('/v1/orders/lookup')
        .send(as({ contactEmail: 'otro@example.com' }))
        .expect(404);
      const conflict = await reorder(
        as({ publicCode: pending.publicCode }),
      ).expect(409);
      await reorder(as({ cartId: randomUUID() })).expect(404);
      const notActive = await reorder(as({ cartId: cancelled.cartId })).expect(
        409,
      );
      const invalid = await reorder(as({ cartId: 'no-es-un-uuid' })).expect(
        400,
      );
      expect(invalid.body.errors).toEqual([
        expect.objectContaining({ field: 'cartId', code: 'isUuid' }),
      ]);
      const forbidden = await reorder(as({}), manager).expect(403);

      // The same problem as the lookup's, but for its route and its correlation ID.
      const { type, title, status, detail } = lookup.body as Record<
        string,
        unknown
      >;
      expect(missing.body).toEqual({
        type,
        title,
        status,
        detail,
        instance: '/v1/orders/reorder',
        correlationId: expect.any(String),
      });
      expect(conflict.body.currentStatus).toBe('PENDING_PAYMENT');
      expect(notActive.body).toMatchObject({
        type: '/problems/cart-not-active',
        cartStatus: 'CHECKED_OUT',
      });
      expect(forbidden.body.type).toBe('/problems/staff-cannot-purchase');
    });
  });

  describe('the staff (POST /v1/admin/orders/{orderId}/reorder)', () => {
    const reorder = (orderId: string, user = manager) =>
      http().post(`/v1/admin/orders/${orderId}/reorder`).set(signedInAs(user));

    it('copies a customer’s order into the customer’s cart, and audits it', async () => {
      const shirt = await variant();
      const user = await customer();
      const order = await customerOrder(user, [
        { variantId: shirt, quantity: 2 },
      ]);
      await cancel(order.id);

      const { body } = await reorder(order.id).expect(200);

      const cart = await http()
        .get('/v1/me/cart')
        .set(signedInAs(user))
        .expect(200);
      expect(cart.body.id).toBe(body.cartId);
      expect(quantities(cart.body.lines)).toEqual([[shirt, 2]]);
      expect(
        await prisma.auditLog.findFirstOrThrow({
          where: { action: 'orders.reorder' },
        }),
      ).toMatchObject({
        actorId: manager.id,
        resourceType: 'order',
        resourceId: order.id,
      });
    });

    it('reopens the cart of a guest order with the lines still sold, and adds to it after that (ADR-0082)', async () => {
      const [shirt, cap] = [await variant(), await variant()];
      const order = await guestOrder([
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ]);
      await cancel(order.id);
      await discontinue(cap);

      const first = await reorder(order.id).expect(200);
      const reopened = await guestCart(order.cartId);
      await reorder(order.id).expect(200);

      expect(first.body).toEqual({
        cartId: order.cartId,
        skippedVariantIds: [cap],
      });
      expect(reopened.status).toBe('ACTIVE');
      expect(quantities(reopened.lines)).toEqual([[shirt, 2]]);
      expect(quantities((await guestCart(order.cartId)).lines)).toEqual([
        [shirt, 4],
      ]);
    });

    it('answers 409 source-cart-unavailable when the guest’s cart no longer exists, without creating another', async () => {
      const shirt = await variant();
      const order = await guestOrder([{ variantId: shirt, quantity: 1 }]);
      await cancel(order.id);
      await prisma.cart.delete({ where: { id: order.cartId } });

      const response = await reorder(order.id).expect(409);

      expect(response.body.type).toBe('/problems/source-cart-unavailable');
      expect(await prisma.cart.count()).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { action: 'orders.reorder' } }),
      ).toBe(0);
    });

    it('needs orders.manage, an order that exists and one that is cancelled or refunded', async () => {
      const shirt = await variant();
      const pending = await guestOrder([{ variantId: shirt, quantity: 1 }]);

      await reorder(pending.id, staff('orders.read')).expect(403);
      await reorder(newId()).expect(404);
      const conflict = await reorder(pending.id).expect(409);

      expect(conflict.body.currentStatus).toBe('PENDING_PAYMENT');
    });
  });
});
