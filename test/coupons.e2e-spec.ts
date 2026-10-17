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
import {
  type EmailMessage,
  EmailSender,
  newId,
  type PermissionCode,
} from '../src/shared-kernel/index.js';
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
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: null,
};

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** One shirt of $599.00 with 10% off, plus $99.00 of shipping. */
const ONLINE_TOTAL = 59_900 - 5_990 + 9_900;
/** The same shirt handed over in the store, without shipping. */
const COUNTER_TOTAL = 59_900 - 5_990;

/**
 * Coupons over HTTP (T-200 part c, UC-PRM-05, ADR-0168): their management, and the six routes that quote or place an
 * order with one. The limit of the codes nobody has is tested apart (coupon-limits.e2e-spec.ts), so these tests send
 * few of them.
 */
describe('Coupons (e2e, T-200 part c)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailSender)
      .useValue({
        send: (_message: EmailMessage) => Promise.resolve(),
      })
      .compile();
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
          { action: { startsWith: 'orders.' } },
          { action: { startsWith: 'promotions.' } },
        ],
      },
    });
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.promotionTarget.deleteMany();
    await prisma.promotion.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany({ where: { type: 'CUSTOMER' } });
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
  const administrator = staff('promotions.manage', 'promotions.read');
  /** As the seeded Vendedor role, which sells at the counter (ADR-0161). */
  const seller = staff('catalog.read', 'orders.place', 'orders.read');

  /** A customer account with its email verified. */
  async function customer(): Promise<AuthenticatedUser> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        // Not a real hash: these tests never sign in.
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

  /** A published variant of $599.00, with stock in the main warehouse. */
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
            amount: 59_900,
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

  /** A coupon `BUEN-FIN` of 10% of the whole purchase, active now. */
  async function coupon(body: object = {}): Promise<string> {
    return (
      await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({
          name: 'Buen Fin',
          percentage: 10,
          code: 'buen-fin',
          ...body,
        })
        .expect(201)
    ).body.id as string;
  }

  const usesOf = async (id: string) =>
    (await prisma.promotion.findUniqueOrThrow({ where: { id } })).uses;

  async function guestCart(variantId: string) {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId, quantity: 1 })
      .expect(200);
    return cartId;
  }

  async function customerCart(owner: AuthenticatedUser, variantId: string) {
    await http()
      .post('/v1/me/cart/lines')
      .set(signedInAs(owner))
      .send({ variantId, quantity: 1 })
      .expect((response) => expect([200, 201]).toContain(response.status));
  }

  const placeGuest = (cartId: string, body: object = {}) =>
    http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        privacyNoticeVersion: '2026-09',
        expectedTotal: ONLINE_TOTAL,
        couponCode: 'Buen-Fin',
        ...body,
      });

  const counterSale = (variantId: string, body: object = {}) =>
    http()
      .post('/v1/admin/orders')
      .set(signedInAs(seller))
      .set('Idempotency-Key', randomUUID())
      .send({
        lines: [{ variantId, quantity: 1 }],
        warehouseId: MAIN,
        fulfillment: 'IN_STORE',
        expectedTotal: COUNTER_TOTAL,
        couponCode: 'buen-fin',
        ...body,
      });

  function expectRefused(response: request.Response, reason: string): void {
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      type: '/problems/coupon-not-applicable',
      status: 409,
      title: 'Cupón que no aplica',
      reason,
    });
  }

  describe('their management (UC-PRM-01 to 03)', () => {
    it('creates a coupon with its code in uppercase and its limits, and lists it by kind and by its code', async () => {
      const id = await coupon({ usageLimit: 100, oncePerCustomer: true });
      await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Automática', percentage: 5 })
        .expect(201);

      const { body } = await http()
        .get(`/v1/admin/promotions/${id}`)
        .set(signedInAs(administrator))
        .expect(200);
      const listed = async (query: string) =>
        (
          await http()
            .get(`/v1/admin/promotions?${query}`)
            .set(signedInAs(administrator))
            .expect(200)
        ).body.data.map(({ name }: { name: string }) => name);

      expect(body).toMatchObject({
        code: 'BUEN-FIN',
        usageLimit: 100,
        oncePerCustomer: true,
        uses: 0,
        status: 'ACTIVE',
      });
      expect(await listed('kind=COUPON')).toEqual(['Buen Fin']);
      expect(await listed('kind=AUTOMATIC')).toEqual(['Automática']);
      expect(await listed('q=buen-fin')).toEqual(['Buen Fin']);
      const { body: page } = await http()
        .get('/v1/admin/promotions?kind=COUPON')
        .set(signedInAs(administrator))
        .expect(200);
      expect(page.data[0]).toMatchObject({
        code: 'BUEN-FIN',
        usageLimit: 100,
        oncePerCustomer: true,
        uses: 0,
      });
    });

    it('answers a code another promotion has, whatever its case, as a duplicate value', async () => {
      await coupon();
      const other = await coupon({ code: 'OTRO' });

      const created = await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Copia', percentage: 5, code: 'BUEN-fin' })
        .expect(409);
      const edited = await http()
        .patch(`/v1/admin/promotions/${other}`)
        .set(signedInAs(administrator))
        .send({ usageLimit: 3, version: 1 })
        .expect(200);

      expect(created.body).toMatchObject({
        type: '/problems/duplicate-value',
        field: 'code',
      });
      expect(edited.body.usageLimit).toBe(3);
    });

    it.each([
      [{ code: 'ABC' }, 'code'],
      [{ code: 'HOLA 10' }, 'code'],
      [{ code: 'A'.repeat(31) }, 'code'],
      [{ code: 'HOLA', usageLimit: 0 }, 'usageLimit'],
      [{ code: 'HOLA', usageLimit: 1.5 }, 'usageLimit'],
      [{ code: 'HOLA', oncePerCustomer: 'sí' }, 'oncePerCustomer'],
    ])('refuses %j naming %s', async (body, field) => {
      const response = await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Cupón', percentage: 5, ...body })
        .expect(400);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });

    it('refuses limits of use without a code, and a usage limit below the uses', async () => {
      const id = await coupon({ usageLimit: 5 });
      await prisma.promotion.update({ where: { id }, data: { uses: 4 } });

      const automatic = await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Automática', percentage: 5, usageLimit: 5 })
        .expect(400);
      const below = await http()
        .patch(`/v1/admin/promotions/${id}`)
        .set(signedInAs(administrator))
        .send({ usageLimit: 3, version: 1 })
        .expect(400);

      expect(automatic.body.type).toBe('/problems/validation-error');
      expect(below.body.errors).toEqual([
        {
          field: 'usageLimit',
          code: 'belowUses',
          message: 'No puede ser menor que los usos que ya tiene: 4.',
        },
      ]);
    });

    it('refuses to change the code once it started', async () => {
      const id = await coupon();

      const response = await http()
        .patch(`/v1/admin/promotions/${id}`)
        .set(signedInAs(administrator))
        .send({ code: 'OTRO', version: 1 })
        .expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        currentStatus: 'ACTIVE',
      });
    });
  });

  describe('the six routes (UC-PRM-05)', () => {
    it('quotes and places a guest order with the coupon, instead of a larger automatic promotion, counting its use', async () => {
      const shirt = await variant();
      const id = await coupon({ usageLimit: 10 });
      await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Mitad', percentage: 50 })
        .expect(201);
      const cartId = await guestCart(shirt);

      const { body: quoted } = await http()
        .post('/v1/checkout/quote')
        .send({ cartId, couponCode: ' buen-fin ' })
        .expect(200);
      expect(await usesOf(id)).toBe(0);
      const { body: placed } = await placeGuest(cartId).expect(201);

      const promotion = { id, name: 'Buen Fin', code: 'BUEN-FIN' };
      expect(quoted).toMatchObject({
        discountTotal: mxn(5_990),
        grandTotal: mxn(ONLINE_TOTAL),
        promotion,
      });
      expect(placed).toMatchObject({
        discountTotal: mxn(5_990),
        grandTotal: mxn(ONLINE_TOTAL),
        promotion,
      });
      expect(await usesOf(id)).toBe(1);
      // Without the coupon, the automatic promotion applies.
      const { body: automatic } = await http()
        .post('/v1/checkout/quote')
        .send({ cartId: await guestCart(shirt), couponCode: null })
        .expect(200);
      expect(automatic.promotion).toMatchObject({ name: 'Mitad', code: null });
    });

    it("quotes and places a customer's order with the coupon", async () => {
      const shirt = await variant();
      const id = await coupon();
      const buyer = await customer();
      await customerCart(buyer, shirt);

      const { body: quoted } = await http()
        .post('/v1/me/checkout/quote')
        .set(signedInAs(buyer))
        .send({ couponCode: 'BUEN-FIN' })
        .expect(200);
      const { body: placed } = await http()
        .post('/v1/me/orders')
        .set(signedInAs(buyer))
        .set('Idempotency-Key', randomUUID())
        .send({
          shippingAddress: ADDRESS,
          expectedTotal: ONLINE_TOTAL,
          couponCode: 'buen-fin',
        })
        .expect(201);

      expect(quoted.promotion).toEqual({
        id,
        name: 'Buen Fin',
        code: 'BUEN-FIN',
      });
      expect(placed).toMatchObject({
        grandTotal: mxn(ONLINE_TOTAL),
        promotion: { id, code: 'BUEN-FIN' },
      });
      expect(await usesOf(id)).toBe(1);
      // A quote without a body still works.
      await customerCart(buyer, shirt);
      await http()
        .post('/v1/me/checkout/quote')
        .set(signedInAs(buyer))
        .expect(200);
    });

    it('quotes and places a sale of the physical store with the coupon', async () => {
      const shirt = await variant();
      const id = await coupon({ channels: ['STORE'] });

      const { body: quoted } = await http()
        .post('/v1/admin/orders/quote')
        .set(signedInAs(seller))
        .send({
          lines: [{ variantId: shirt, quantity: 1 }],
          warehouseId: MAIN,
          fulfillment: 'IN_STORE',
          couponCode: 'buen-fin',
        })
        .expect(200);
      const { body: placed } = await counterSale(shirt).expect(201);

      expect(quoted).toMatchObject({
        grandTotal: mxn(COUNTER_TOTAL),
        promotion: { id, code: 'BUEN-FIN' },
      });
      expect(placed).toMatchObject({
        channel: 'STORE',
        grandTotal: mxn(COUNTER_TOTAL),
        promotion: { id, code: 'BUEN-FIN' },
      });
      expect(await usesOf(id)).toBe(1);
    });

    it.each([
      ['an empty code', ''],
      ['a code of spaces', '   '],
      ['a code of 31 characters', 'A'.repeat(31)],
      ['a code that is not text', 10],
    ])('refuses %s on every route', async (_case, couponCode) => {
      const shirt = await variant();
      const buyer = await customer();
      const cartId = await guestCart(shirt);

      for (const response of [
        await http().post('/v1/checkout/quote').send({ cartId, couponCode }),
        await http()
          .post('/v1/me/checkout/quote')
          .set(signedInAs(buyer))
          .send({ couponCode }),
        await placeGuest(cartId, { couponCode }),
        await counterSale(shirt, { couponCode }),
      ]) {
        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual([
          expect.objectContaining({ field: 'couponCode' }),
        ]);
      }
    });
  });

  describe('a coupon that does not apply', () => {
    it('answers unavailable for a code nobody has and for a coupon of another channel, without the automatic promotion', async () => {
      const shirt = await variant();
      await coupon({ channels: ['STORE'] });
      await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Automática', percentage: 5 })
        .expect(201);
      const cartId = await guestCart(shirt);

      expectRefused(
        await http()
          .post('/v1/checkout/quote')
          .send({ cartId, couponCode: 'NADIE-LO-TIENE' }),
        'unavailable',
      );
      expectRefused(await placeGuest(cartId), 'unavailable');
      expect(await prisma.order.count()).toBe(0);
    });

    it('answers minimumNotMet and noEligibleLines', async () => {
      const shirt = await variant();
      const other = await prisma.productVariant.findUniqueOrThrow({
        where: { id: await variant() },
      });
      await coupon({ minimumSubtotal: 60_000 });
      await coupon({
        code: 'OTRO-PRODUCTO',
        targets: [{ type: 'PRODUCT', id: other.productId }],
      });
      const cartId = await guestCart(shirt);

      expectRefused(
        await http()
          .post('/v1/checkout/quote')
          .send({ cartId, couponCode: 'buen-fin' }),
        'minimumNotMet',
      );
      expectRefused(
        await http()
          .post('/v1/checkout/quote')
          .send({ cartId, couponCode: 'otro-producto' }),
        'noEligibleLines',
      );
    });

    it('answers exhausted once its uses reach the limit, in the quote and in the order', async () => {
      const shirt = await variant();
      const id = await coupon({ usageLimit: 1 });
      await placeGuest(await guestCart(shirt)).expect(201);
      const cartId = await guestCart(shirt);

      expectRefused(
        await http()
          .post('/v1/checkout/quote')
          .send({ cartId, couponCode: 'buen-fin' }),
        'exhausted',
      );
      expectRefused(await placeGuest(cartId), 'exhausted');
      expect(await usesOf(id)).toBe(1);
      expect(await prisma.order.count()).toBe(1);
    });

    it('answers alreadyUsed to a customer in the quote, and to a guest with the same contact in the order', async () => {
      const shirt = await variant();
      await coupon({ oncePerCustomer: true });
      const buyer = await customer();
      const email = `${buyer.id}@example.com`;
      await customerCart(buyer, shirt);
      await http()
        .post('/v1/me/orders')
        .set(signedInAs(buyer))
        .set('Idempotency-Key', randomUUID())
        .send({
          shippingAddress: ADDRESS,
          expectedTotal: ONLINE_TOTAL,
          couponCode: 'buen-fin',
        })
        .expect(201);
      await customerCart(buyer, shirt);
      const cartId = await guestCart(shirt);

      expectRefused(
        await http()
          .post('/v1/me/checkout/quote')
          .set(signedInAs(buyer))
          .send({ couponCode: 'buen-fin' }),
        'alreadyUsed',
      );
      // A guest quote cannot know who buys: the order tells them.
      await http()
        .post('/v1/checkout/quote')
        .send({ cartId, couponCode: 'buen-fin' })
        .expect(200);
      expectRefused(
        await placeGuest(cartId, { contactEmail: email.toUpperCase() }),
        'alreadyUsed',
      );
      await placeGuest(cartId, { contactEmail: 'otra@example.com' }).expect(
        201,
      );
    });

    it('answers buyerRequired for a counter sale without buyer data and a coupon of once per customer', async () => {
      const shirt = await variant();
      await coupon({ oncePerCustomer: true });

      expectRefused(await counterSale(shirt), 'buyerRequired');
      await counterSale(shirt, {
        contactEmail: 'cliente@example.com',
        privacyNoticeVersion: '2026-09',
      }).expect(201);
    });

    it('gives back the use of a cancelled order', async () => {
      const shirt = await variant();
      const id = await coupon({ usageLimit: 1 });
      const { body: placed } = await counterSale(shirt).expect(201);
      expect(await usesOf(id)).toBe(1);

      await http()
        .post(`/v1/admin/orders/${placed.id}/cancel`)
        .set(signedInAs(staff('orders.manage', 'orders.read')))
        .send({
          reason: 'Se arrepintió',
          restock: false,
          version: placed.version,
        })
        .expect(200);

      expect(await usesOf(id)).toBe(0);
      await counterSale(shirt).expect(201);
    });
  });
});
