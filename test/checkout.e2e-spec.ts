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

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
/** `XXXX-XXXX` in Base32 Crockford (ADR-0049). */
const PUBLIC_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: '4B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: 'Entre Galeana e Hidalgo',
};

const SNAPSHOT = {
  ...ADDRESS,
  stateName: 'Michoacán de Ocampo',
  municipalityName: 'Morelia',
  country: 'MX',
};

const mxn = (amount: number) => ({ amount, currency: 'MXN' });

/** A municipality INEGI retired: no new address may use it (BR-ADR-03). */
const RETIRED = '16998';

/** Checkout and the customer's orders over HTTP (T-180 part a, UC-ORD-01 to 03, API_SPEC.md §15). */
describe('Checkout and orders (e2e, T-180)', () => {
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
    for (const [code, name] of [
      ['16', 'Michoacán de Ocampo'],
      ['14', 'Jalisco'],
    ]) {
      await prisma.geoState.upsert({
        where: { code },
        create: { code, name },
        update: {},
      });
    }
    for (const [code, stateCode, name, isActive] of [
      ['16053', '16', 'Morelia', true],
      ['14039', '14', 'Guadalajara', true],
      [RETIRED, '16', 'Municipio retirado', false],
    ] as const) {
      await prisma.geoMunicipality.upsert({
        where: { code },
        create: { code, stateCode, name, isActive },
        update: { isActive },
      });
    }
  });

  afterEach(async () => {
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
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customerAddress.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.geoMunicipality.deleteMany({ where: { code: RETIRED } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const staff: AuthenticatedUser = {
    id: newId(),
    type: 'STAFF',
    permissions: ['orders.read'],
    mustChangePassword: false,
    sessionId: newId(),
  };

  /** A customer account, with its email verified unless told otherwise. */
  async function customer(verified = true): Promise<AuthenticatedUser> {
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
        emailVerifiedAt: verified ? new Date() : null,
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

  async function savedAddress(owner: AuthenticatedUser): Promise<string> {
    const id = newId();
    await prisma.customerAddress.create({
      data: { id, userId: owner.id, ...ADDRESS, isDefault: true },
    });
    return id;
  }

  /** A variant of a product, published unless told otherwise, priced unless `price` is null. */
  async function variant(
    options: { price?: number | null; stock?: number } = {},
  ): Promise<{ id: string; productId: string; sku: string }> {
    const productId = newId();
    const id = newId();
    const sku = `CAM-${id.slice(-12)}`.toUpperCase();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug: `camisa-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: { id, sku, options: { talla: 'M' }, status: 'ACTIVE' },
        },
      },
    });
    if (options.price !== null) {
      await prisma.variantPrice.create({
        data: {
          id: newId(),
          priceListId: DEFAULT_LIST,
          variantId: id,
          periods: {
            create: {
              id: newId(),
              amount: options.price ?? 59_900,
              effectiveFrom: new Date(Date.now() - 86_400_000),
              createdBy: newId(),
            },
          },
        },
      });
    }
    await prisma.stockItem.create({
      data: {
        id: newId(),
        variantId: id,
        warehouseId: MAIN,
        onHand: options.stock ?? 5,
      },
    });
    return { id, productId, sku };
  }

  /** A guest cart with these lines. */
  async function guestCart(
    ...lines: { variantId: string; quantity: number }[]
  ): Promise<string> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    for (const line of lines) {
      await http().post(`/v1/carts/${cartId}/lines`).send(line).expect(200);
    }
    return cartId;
  }

  async function customerCart(
    owner: AuthenticatedUser,
    ...lines: { variantId: string; quantity: number }[]
  ): Promise<void> {
    for (const line of lines) {
      await http()
        .post('/v1/me/cart/lines')
        .set(signedInAs(owner))
        .send(line)
        .expect((response) => expect([200, 201]).toContain(response.status));
    }
  }

  const guestOrder = (cartId: string, overrides: object = {}) => ({
    cartId,
    contactEmail: '  Cliente@Example.com ',
    shippingAddress: ADDRESS,
    expectedTotal: 129_700,
    privacyNoticeVersion: '2026-09',
    ...overrides,
  });

  const placeGuest = (body: object, key: string = randomUUID()) =>
    http().post('/v1/orders').set('Idempotency-Key', key).send(body);

  const placeAs = (
    owner: AuthenticatedUser,
    body: object,
    key: string = randomUUID(),
  ) =>
    http()
      .post('/v1/me/orders')
      .set(signedInAs(owner))
      .set('Idempotency-Key', key)
      .send(body);

  const reserved = async (variantId: string) =>
    (await prisma.stockItem.findFirstOrThrow({ where: { variantId } }))
      .reserved;

  const cartStatus = async (id: string) =>
    (await prisma.cart.findUniqueOrThrow({ where: { id } })).status;

  describe('quote (UC-ORD-01)', () => {
    it('prices a guest cart with VAT by line, shipping and delivery, without changing anything', async () => {
      const shirt = await variant({ price: 59_900 });
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });

      const response = await http()
        .post('/v1/checkout/quote')
        .send({ cartId })
        .expect(200);

      // The example of API_SPEC.md §8.7.
      expect(response.body).toEqual({
        lines: [
          {
            variantId: shirt.id,
            quantity: 2,
            sku: shirt.sku,
            productTitle: 'Camisa de lino',
            options: { talla: 'M' },
            unitPrice: mxn(59_900),
            lineTotal: mxn(119_800),
            taxRateBp: 1600,
            taxAmount: mxn(16_524),
            sellable: true,
            canFulfill: true,
          },
        ],
        subtotal: mxn(119_800),
        taxTotal: mxn(17_890),
        shippingCost: mxn(9_900),
        shippingTaxAmount: mxn(1_366),
        discountTotal: mxn(0),
        grandTotal: mxn(129_700),
        freeShippingThreshold: mxn(150_000),
        estimatedDelivery: { minBusinessDays: 3, maxBusinessDays: 7 },
        readyToPlace: true,
      });
      expect(await reserved(shirt.id)).toBe(0);
      expect(await cartStatus(cartId)).toBe('ACTIVE');
      expect(await prisma.order.count()).toBe(0);
    });

    it('ships free from the threshold on (ADR-0079)', async () => {
      const shirt = await variant({ price: 75_000 });
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });

      const { body } = await http()
        .post('/v1/checkout/quote')
        .send({ cartId })
        .expect(200);

      expect(body).toMatchObject({
        subtotal: mxn(150_000),
        shippingCost: mxn(0),
        shippingTaxAmount: mxn(0),
        taxTotal: mxn(20_690),
        grandTotal: mxn(150_000),
      });
    });

    it('marks lines that cannot be sold or fulfilled, and totals only the sellable ones', async () => {
      const shirt = await variant({ price: 59_900, stock: 1 });
      const hat = await variant({ price: 20_000 });
      const cartId = await guestCart(
        { variantId: shirt.id, quantity: 2 },
        { variantId: hat.id, quantity: 1 },
      );
      await prisma.product.update({
        where: { id: hat.productId },
        data: { status: 'ARCHIVED' },
      });

      const { body } = await http()
        .post('/v1/checkout/quote')
        .send({ cartId })
        .expect(200);

      expect(body.lines).toEqual([
        expect.objectContaining({
          variantId: shirt.id,
          sellable: true,
          canFulfill: false,
        }),
        {
          variantId: hat.id,
          quantity: 1,
          sku: hat.sku,
          productTitle: 'Camisa de lino',
          options: { talla: 'M' },
          unitPrice: null,
          lineTotal: null,
          taxRateBp: null,
          taxAmount: null,
          sellable: false,
          canFulfill: false,
        },
      ]);
      expect(body).toMatchObject({
        subtotal: mxn(119_800),
        grandTotal: mxn(129_700),
        readyToPlace: false,
      });
    });

    it('quotes the active cart of the signed-in customer', async () => {
      const shirt = await variant();
      const buyer = await customer();
      await customerCart(buyer, { variantId: shirt.id, quantity: 2 });

      const { body } = await http()
        .post('/v1/me/checkout/quote')
        .set(signedInAs(buyer))
        .expect(200);

      expect(body).toMatchObject({
        grandTotal: mxn(129_700),
        readyToPlace: true,
      });
    });

    it('answers 404 for a guest cart that does not exist or has an owner', async () => {
      const buyer = await customer();
      const shirt = await variant();
      await customerCart(buyer, { variantId: shirt.id, quantity: 1 });
      const owned = await prisma.cart.findFirstOrThrow({
        where: { ownerUserId: buyer.id },
      });

      for (const cartId of [randomUUID(), owned.id]) {
        const response = await http()
          .post('/v1/checkout/quote')
          .send({ cartId })
          .expect(404);
        expect(response.body.type).toBe('/problems/not-found');
      }
    });

    it('answers 409 empty-cart for a cart without lines or a customer without a cart (BR-ORD-01)', async () => {
      const cartId = await guestCart();

      const guest = await http()
        .post('/v1/checkout/quote')
        .send({ cartId })
        .expect(409);
      const signedIn = await http()
        .post('/v1/me/checkout/quote')
        .set(signedInAs(await customer()))
        .expect(409);

      expect(guest.body.type).toBe('/problems/empty-cart');
      expect(signedIn.body.type).toBe('/problems/empty-cart');
    });

    it('answers 403 staff-cannot-purchase to the staff, and 401 without a token on the customer route', async () => {
      const cartId = await guestCart();

      for (const path of ['/v1/checkout/quote', '/v1/me/checkout/quote']) {
        const response = await http()
          .post(path)
          .set(signedInAs(staff))
          .send({ cartId })
          .expect(403);
        expect(response.body.type).toBe('/problems/staff-cannot-purchase');
      }
      await http().post('/v1/me/checkout/quote').expect(401);
    });
  });

  describe('guest order (UC-ORD-02)', () => {
    it('places the order: reserves the stock, keeps the snapshots and checks the cart out', async () => {
      const shirt = await variant({ price: 59_900 });
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });

      const response = await placeGuest(guestOrder(cartId)).expect(201);

      expect(response.headers.location).toBeUndefined();
      expect(response.body).toEqual({
        publicCode: expect.stringMatching(PUBLIC_CODE),
        status: 'PENDING_PAYMENT',
        contactEmail: 'cliente@example.com',
        itemCount: 2,
        lines: [
          {
            lineNumber: 1,
            sku: shirt.sku,
            productName: 'Camisa de lino',
            variantOptions: { talla: 'M' },
            unitPrice: mxn(59_900),
            quantity: 2,
            taxRateBp: 1600,
            taxAmount: mxn(16_524),
            lineTotal: mxn(119_800),
          },
        ],
        subtotal: mxn(119_800),
        taxTotal: mxn(17_890),
        shippingCost: mxn(9_900),
        shippingTaxAmount: mxn(1_366),
        discountTotal: mxn(0),
        grandTotal: mxn(129_700),
        shippingAddress: SNAPSHOT,
        estimatedDelivery: { minBusinessDays: 3, maxBusinessDays: 7 },
        payment: null,
        shipment: null,
        placedAt: expect.any(String),
        paymentDueAt: expect.any(String),
        paidAt: null,
        shippedAt: null,
        deliveredAt: null,
        cancelledAt: null,
        expiredAt: null,
        refundedAt: null,
      });
      const { placedAt, paymentDueAt } = response.body;
      // RESERVATION_TTL: 20 minutes by default (ADR-0128).
      expect(
        Date.parse(paymentDueAt) - Date.parse(placedAt) - 20 * 60_000,
      ).toBeLessThan(1_000);

      const order = await prisma.order.findFirstOrThrow({
        include: { statusHistory: true },
      });
      expect(order).toMatchObject({
        publicCode: response.body.publicCode.replace('-', ''),
        customerId: null,
        privacyNoticeVersion: '2026-09',
        sourceCartId: cartId,
        shippingTaxRateBp: 1600,
      });
      expect(order.orderNumber).toBeGreaterThan(0n);
      expect(order.statusHistory).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: 'PENDING_PAYMENT',
          actorId: null,
        }),
      ]);
      const reservation = await prisma.reservation.findFirstOrThrow();
      expect(reservation).toMatchObject({
        id: order.reservationId,
        orderId: order.id,
        status: 'ACTIVE',
        expiresAt: order.paymentDueAt,
      });
      expect(await reserved(shirt.id)).toBe(2);
      expect(await cartStatus(cartId)).toBe('CHECKED_OUT');
    });

    it('replays the same order for the same key and content, and requires the key (ADR-0063)', async () => {
      const shirt = await variant();
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });
      const key = randomUUID();

      const first = await placeGuest(guestOrder(cartId), key).expect(201);
      const second = await placeGuest(guestOrder(cartId), key).expect(201);
      const missing = await http()
        .post('/v1/orders')
        .send(guestOrder(cartId))
        .expect(400);

      expect(second.body).toEqual(first.body);
      expect(await prisma.order.count()).toBe(1);
      expect(missing.body.type).toBe('/problems/idempotency-key-missing');
    });

    it('answers 409 total-mismatch with the current total, and places nothing (BR-ORD-06)', async () => {
      const shirt = await variant();
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });

      const response = await placeGuest(
        guestOrder(cartId, { expectedTotal: 129_699 }),
      ).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/total-mismatch',
        currentTotal: mxn(129_700),
      });
      expect(await prisma.order.count()).toBe(0);
      expect(await reserved(shirt.id)).toBe(0);
      expect(await cartStatus(cartId)).toBe('ACTIVE');
    });

    it('answers 409 insufficient-stock with the short lines, and reserves nothing (BR-INV-02)', async () => {
      const shirt = await variant({ price: 10_000, stock: 5 });
      const hat = await variant({ price: 10_000, stock: 1 });
      const cartId = await guestCart(
        { variantId: shirt.id, quantity: 2 },
        { variantId: hat.id, quantity: 2 },
      );

      const response = await placeGuest(
        guestOrder(cartId, { expectedTotal: 49_900 }),
      ).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/insufficient-stock',
        lines: [{ variantId: hat.id, canFulfill: false }],
      });
      expect(await reserved(shirt.id)).toBe(0);
      expect(await prisma.order.count()).toBe(0);
      expect(await cartStatus(cartId)).toBe('ACTIVE');
    });

    it('places the order in one warehouse: the quote and the 409 name what the closest one lacks (ADR-0160)', async () => {
      const north = newId();
      await prisma.warehouse.create({
        data: {
          id: north,
          code: 'NORTE',
          name: 'Almacén norte',
          status: 'ACTIVE',
          priority: 2,
        },
      });
      const shirt = await variant({ price: 10_000, stock: 2 });
      const hat = await variant({ price: 10_000, stock: 0 });
      await prisma.stockItem.create({
        data: { id: newId(), variantId: hat.id, warehouseId: north, onHand: 1 },
      });
      const cartId = await guestCart(
        { variantId: shirt.id, quantity: 2 },
        { variantId: hat.id, quantity: 1 },
      );
      const quote = async () =>
        (await http().post('/v1/checkout/quote').send({ cartId }).expect(200))
          .body as {
          lines: { variantId: string; canFulfill: boolean }[];
          readyToPlace: boolean;
        };
      const reservedIn = async (variantId: string, warehouseId: string) =>
        (
          await prisma.stockItem.findUniqueOrThrow({
            where: { variantId_warehouseId: { variantId, warehouseId } },
          })
        ).reserved;

      // Each line alone fits somewhere, but no warehouse holds both: the main one, first, lacks the hat.
      const cart = await http().get(`/v1/carts/${cartId}`).expect(200);
      const split = await quote();
      const short = await placeGuest(
        guestOrder(cartId, { expectedTotal: 39_900 }),
      ).expect(409);
      await prisma.stockItem.create({
        data: {
          id: newId(),
          variantId: shirt.id,
          warehouseId: north,
          onHand: 2,
        },
      });
      const whole = await quote();
      await placeGuest(guestOrder(cartId, { expectedTotal: 39_900 })).expect(
        201,
      );

      expect(
        cart.body.lines.map(
          ({ canFulfill }: { canFulfill: boolean }) => canFulfill,
        ),
      ).toEqual([true, true]);
      expect([
        split.lines.map(({ canFulfill }) => canFulfill),
        split.readyToPlace,
      ]).toEqual([[true, false], false]);
      expect(short.body).toMatchObject({
        type: '/problems/insufficient-stock',
        lines: [{ variantId: hat.id, canFulfill: false }],
      });
      expect([
        whole.lines.map(({ canFulfill }) => canFulfill),
        whole.readyToPlace,
      ]).toEqual([[true, true], true]);
      expect([
        await reservedIn(shirt.id, north),
        await reservedIn(hat.id, north),
        await reservedIn(shirt.id, MAIN),
      ]).toEqual([2, 1, 0]);
    });

    it('answers 409 variant-not-sellable for a line that can no longer be sold', async () => {
      const shirt = await variant();
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });
      await prisma.productVariant.update({
        where: { id: shirt.id },
        data: { status: 'DISCONTINUED' },
      });

      const response = await placeGuest(guestOrder(cartId)).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/variant-not-sellable',
        variantIds: [shirt.id],
      });
    });

    it('checks the state and municipality against the INEGI catalog', async () => {
      const shirt = await variant();
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });
      const key = randomUUID();

      const unknown = await placeGuest(
        guestOrder(cartId, {
          shippingAddress: { ...ADDRESS, stateCode: '33' },
        }),
        key,
      ).expect(400);
      const elsewhere = await placeGuest(
        guestOrder(cartId, {
          shippingAddress: { ...ADDRESS, municipalityCode: '14039' },
        }),
        key,
      ).expect(400);

      expect(unknown.body.errors).toEqual([
        expect.objectContaining({
          field: 'shippingAddress.stateCode',
          code: 'isState',
        }),
      ]);
      expect(elsewhere.body.errors).toEqual([
        expect.objectContaining({
          field: 'shippingAddress.municipalityCode',
          code: 'isMunicipalityOfState',
        }),
      ]);
      const retired = await placeGuest(
        guestOrder(cartId, {
          shippingAddress: { ...ADDRESS, municipalityCode: RETIRED },
        }),
        key,
      ).expect(400);
      expect(retired.body.errors).toEqual([
        expect.objectContaining({
          field: 'shippingAddress.municipalityCode',
          code: 'isActiveMunicipality',
        }),
      ]);
      // A validation error frees the key: the corrected order goes through with it.
      await placeGuest(guestOrder(cartId), key).expect(201);
    });

    it('validates the request', async () => {
      const cartId = randomUUID();

      const response = await placeGuest({
        ...guestOrder(cartId),
        contactEmail: 'no-es-un-email',
        privacyNoticeVersion: ' ',
        expectedTotal: -1,
        shippingAddress: { ...ADDRESS, phone: '123' },
      }).expect(400);

      expect(
        response.body.errors.map(({ field }: { field: string }) => field),
      ).toEqual(
        expect.arrayContaining([
          'contactEmail',
          'privacyNoticeVersion',
          'expectedTotal',
          'shippingAddress.phone',
        ]),
      );
    });

    it('answers 409 cart-not-active to a second order of the same cart', async () => {
      const shirt = await variant();
      const cartId = await guestCart({ variantId: shirt.id, quantity: 2 });
      await placeGuest(guestOrder(cartId)).expect(201);

      const response = await placeGuest(guestOrder(cartId)).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/cart-not-active',
        cartStatus: 'CHECKED_OUT',
      });
      expect(await prisma.order.count()).toBe(1);
    });

    it('answers 403 staff-cannot-purchase to the staff', async () => {
      const response = await http()
        .post('/v1/orders')
        .set(signedInAs(staff))
        .set('Idempotency-Key', randomUUID())
        .send(guestOrder(randomUUID()))
        .expect(403);

      expect(response.body.type).toBe('/problems/staff-cannot-purchase');
    });
  });

  describe('customer order (UC-ORD-02)', () => {
    it('places the order with a saved address and the account email, and the next line opens a new cart', async () => {
      const shirt = await variant();
      const buyer = await customer();
      const addressId = await savedAddress(buyer);
      await customerCart(buyer, { variantId: shirt.id, quantity: 2 });

      const response = await placeAs(buyer, {
        addressId,
        expectedTotal: 129_700,
      }).expect(201);

      expect(response.headers.location).toBe(
        `/v1/me/orders/${response.body.publicCode}`,
      );
      expect(response.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        contactEmail: `${buyer.id}@example.com`,
        shippingAddress: SNAPSHOT,
        grandTotal: mxn(129_700),
      });
      const order = await prisma.order.findFirstOrThrow({
        include: { statusHistory: true },
      });
      expect(order).toMatchObject({
        customerId: buyer.id,
        privacyNoticeVersion: null,
      });
      expect(order.statusHistory[0].actorId).toBe(buyer.id);
      expect(await reserved(shirt.id)).toBe(2);

      await http()
        .post('/v1/me/cart/lines')
        .set(signedInAs(buyer))
        .send({ variantId: shirt.id, quantity: 1 })
        .expect(201);
    });

    it('places the order with an address written for it', async () => {
      const shirt = await variant();
      const buyer = await customer();
      await customerCart(buyer, { variantId: shirt.id, quantity: 2 });

      const { body } = await placeAs(buyer, {
        shippingAddress: { ...ADDRESS, interiorNumber: undefined },
        expectedTotal: 129_700,
      }).expect(201);

      expect(body.shippingAddress).toEqual({
        ...SNAPSHOT,
        interiorNumber: null,
      });
    });

    it('needs exactly one of addressId and shippingAddress', async () => {
      const buyer = await customer();
      const addressId = await savedAddress(buyer);

      for (const body of [
        { expectedTotal: 0 },
        { addressId, shippingAddress: ADDRESS, expectedTotal: 0 },
      ]) {
        const response = await placeAs(buyer, body).expect(400);
        expect(response.body.errors).toEqual([
          expect.objectContaining({
            field: 'addressId',
            code: 'exactlyOneAddress',
          }),
        ]);
      }
    });

    it("answers 404 for another customer's address", async () => {
      const shirt = await variant();
      const buyer = await customer();
      const theirs = await savedAddress(await customer());
      await customerCart(buyer, { variantId: shirt.id, quantity: 2 });

      const response = await placeAs(buyer, {
        addressId: theirs,
        expectedTotal: 129_700,
      }).expect(404);

      expect(response.body.type).toBe('/problems/not-found');
      expect(await reserved(shirt.id)).toBe(0);
    });

    it('answers 403 email-not-verified, reserving nothing (BR-USR-05)', async () => {
      const shirt = await variant();
      const buyer = await customer(false);
      await customerCart(buyer, { variantId: shirt.id, quantity: 2 });

      const response = await placeAs(buyer, {
        shippingAddress: ADDRESS,
        expectedTotal: 129_700,
      }).expect(403);

      expect(response.body.type).toBe('/problems/email-not-verified');
      expect(await reserved(shirt.id)).toBe(0);
    });

    it('answers 409 empty-cart to a customer without an active cart', async () => {
      const response = await placeAs(await customer(), {
        shippingAddress: ADDRESS,
        expectedTotal: 0,
      }).expect(409);

      expect(response.body.type).toBe('/problems/empty-cart');
    });

    it('answers 403 staff-cannot-purchase to the staff', async () => {
      const response = await placeAs(staff, {
        shippingAddress: ADDRESS,
        expectedTotal: 0,
      }).expect(403);

      expect(response.body.type).toBe('/problems/staff-cannot-purchase');
    });
  });

  describe("customer's orders (UC-ORD-03)", () => {
    /** Places an order of `quantity` units of a new variant for the customer, and returns its public code. */
    async function orderOf(
      buyer: AuthenticatedUser,
      quantity: number,
    ): Promise<string> {
      const shirt = await variant({ price: 10_000 });
      await customerCart(buyer, { variantId: shirt.id, quantity });
      const quote = await http()
        .post('/v1/me/checkout/quote')
        .set(signedInAs(buyer))
        .expect(200);
      const { body } = await placeAs(buyer, {
        shippingAddress: ADDRESS,
        expectedTotal: quote.body.grandTotal.amount,
      }).expect(201);
      return body.publicCode as string;
    }

    it("lists only the customer's orders, newest first, without lines nor address", async () => {
      const buyer = await customer();
      const first = await orderOf(buyer, 1);
      const second = await orderOf(buyer, 3);
      await orderOf(await customer(), 1);

      const { body } = await http()
        .get('/v1/me/orders')
        .set(signedInAs(buyer))
        .expect(200);

      expect(body.meta).toEqual({
        page: 1,
        pageSize: 20,
        totalItems: 2,
        totalPages: 1,
      });
      expect(
        body.data.map(({ publicCode }: { publicCode: string }) => publicCode),
      ).toEqual([second, first]);
      expect(body.data[0]).toMatchObject({
        status: 'PENDING_PAYMENT',
        itemCount: 3,
        grandTotal: mxn(39_900),
        payment: null,
      });
      expect(body.data[0]).not.toHaveProperty('lines');
      expect(body.data[0]).not.toHaveProperty('shippingAddress');
      expect(body.data[0]).not.toHaveProperty('id');
      expect(body.data[0]).not.toHaveProperty('orderNumber');
    });

    it('filters by status and date, and sorts by total', async () => {
      const buyer = await customer();
      const small = await orderOf(buyer, 1);
      const large = await orderOf(buyer, 3);
      const list = (query: string) =>
        http().get(`/v1/me/orders?${query}`).set(signedInAs(buyer)).expect(200);

      const byTotal = await list('sort=grandTotal');
      const paid = await list('status=PAID,CANCELLED');
      const pending = await list('status=PENDING_PAYMENT');
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const later = await list(`placedFrom=${tomorrow}`);
      const untilToday = await list(
        `placedTo=${new Date().toISOString().slice(0, 10)}`,
      );

      expect(
        byTotal.body.data.map(
          ({ publicCode }: { publicCode: string }) => publicCode,
        ),
      ).toEqual([small, large]);
      expect(paid.body.meta.totalItems).toBe(0);
      expect(pending.body.meta.totalItems).toBe(2);
      expect(later.body.meta.totalItems).toBe(0);
      expect(untilToday.body.meta.totalItems).toBe(2);
      await http()
        .get('/v1/me/orders?status=PAGADA')
        .set(signedInAs(buyer))
        .expect(400);
    });

    it('shows an order by its public code, with or without the dash and in any case', async () => {
      const buyer = await customer();
      const code = await orderOf(buyer, 2);

      for (const written of [code, code.toLowerCase(), code.replace('-', '')]) {
        const { body } = await http()
          .get(`/v1/me/orders/${written}`)
          .set(signedInAs(buyer))
          .expect(200);
        expect(body).toMatchObject({
          publicCode: code,
          lines: [expect.objectContaining({ lineNumber: 1, quantity: 2 })],
          shippingAddress: SNAPSHOT,
        });
      }
    });

    it("answers 404 for another customer's order or a code that cannot exist", async () => {
      const code = await orderOf(await customer(), 1);
      const other = await customer();

      for (const written of [code, 'ILOU-1234', 'abc']) {
        const response = await http()
          .get(`/v1/me/orders/${written}`)
          .set(signedInAs(other))
          .expect(404);
        expect(response.body.type).toBe('/problems/not-found');
      }
    });

    it('is only for customers', async () => {
      await http().get('/v1/me/orders').expect(401);
      const response = await http()
        .get('/v1/me/orders')
        .set(signedInAs(staff))
        .expect(403);

      expect(response.body.type).toBe('/problems/forbidden');
    });
  });
});
