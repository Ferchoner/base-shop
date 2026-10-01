import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
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
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Carts over HTTP (T-170, UC-CRT-01 to 06, API_SPEC.md §8.6 and §14). */
describe('Cart (e2e, T-170)', () => {
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

  const customerToken = (id = newId()) =>
    signedInAs({
      id,
      type: 'CUSTOMER',
      permissions: [],
      mustChangePassword: false,
      sessionId: newId(),
    });

  const staffToken = signedInAs({
    id: newId(),
    type: 'STAFF',
    permissions: ['catalog.read'],
    mustChangePassword: false,
    sessionId: newId(),
  });

  /** A variant of a product, published unless told otherwise, priced unless `price` is null. */
  async function variant(
    options: {
      price?: number | null;
      stock?: number;
      status?: 'PUBLISHED' | 'DRAFT';
      variantStatus?: 'ACTIVE' | 'DISCONTINUED';
    } = {},
  ): Promise<{ id: string; productId: string; slug: string; sku: string }> {
    const productId = newId();
    const id = newId();
    const slug = `camisa-${productId.slice(-12)}`;
    const sku = `CAM-${id.slice(-12)}`.toUpperCase();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug,
        status: options.status ?? 'PUBLISHED',
        variants: {
          create: {
            id,
            sku,
            options: { talla: 'M' },
            status: options.variantStatus ?? 'ACTIVE',
          },
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
    return { id, productId, slug, sku };
  }

  async function guestCart(): Promise<string> {
    const response = await http().post('/v1/carts').expect(201);
    return response.body.id as string;
  }

  const addTo = (cartId: string, variantId: string, quantity = 1) =>
    http().post(`/v1/carts/${cartId}/lines`).send({ variantId, quantity });

  describe('guest cart (UC-CRT-01 to 05)', () => {
    it('creates an empty cart with a random id and its Location', async () => {
      const response = await http().post('/v1/carts').expect(201);

      expect(response.headers.location).toBe(`/v1/carts/${response.body.id}`);
      expect(response.body).toEqual({
        id: expect.stringMatching(UUID_V4),
        status: 'ACTIVE',
        lines: [],
        itemCount: 0,
        subtotal: { amount: 0, currency: 'MXN' },
        lastActivityAt: expect.any(String),
      });
    });

    it('adds, changes and removes lines, answering the whole cart with prices read now', async () => {
      const shirt = await variant({ price: 59_900, stock: 1 });
      const cartId = await guestCart();

      await addTo(cartId, shirt.id, 1).expect(200);
      const added = await addTo(cartId, shirt.id, 1).expect(200);

      expect(added.body).toEqual({
        id: cartId,
        status: 'ACTIVE',
        lines: [
          {
            variantId: shirt.id,
            quantity: 2,
            product: {
              id: shirt.productId,
              slug: shirt.slug,
              title: 'Camisa de lino',
            },
            sku: shirt.sku,
            options: { talla: 'M' },
            image: null,
            sellable: true,
            canFulfill: false,
            unitPrice: { amount: 59_900, currency: 'MXN' },
            lineTotal: { amount: 119_800, currency: 'MXN' },
          },
        ],
        itemCount: 2,
        subtotal: { amount: 119_800, currency: 'MXN' },
        lastActivityAt: expect.any(String),
      });

      const changed = await http()
        .patch(`/v1/carts/${cartId}/lines/${shirt.id}`)
        .send({ quantity: 1 })
        .expect(200);
      expect(changed.body.lines[0]).toMatchObject({
        quantity: 1,
        canFulfill: true,
      });

      const removed = await http()
        .delete(`/v1/carts/${cartId}/lines/${shirt.id}`)
        .expect(200);
      expect(removed.body).toMatchObject({ lines: [], itemCount: 0 });
      await http().delete(`/v1/carts/${cartId}/lines/${shirt.id}`).expect(200);
      expect(
        (await http().get(`/v1/carts/${cartId}`).expect(200)).body.id,
      ).toBe(cartId);
    });

    it.each([
      [{ quantity: 0 }, 'quantity', 'min'],
      [{ quantity: 31 }, 'quantity', 'max'],
      [{ quantity: 1.5 }, 'quantity', 'isInt'],
      [{ quantity: 'dos' }, 'quantity', 'isInt'],
      [{ variantId: 'camisa' }, 'variantId', 'isUuid'],
      [{ price: 100 }, 'price', 'whitelistValidation'],
    ])('answers 400 for %j', async (body, field, code) => {
      const shirt = await variant();
      const cartId = await guestCart();

      const response = await http()
        .post(`/v1/carts/${cartId}/lines`)
        .send({ variantId: shirt.id, quantity: 1, ...body })
        .expect(400);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ field, code }),
      ]);
    });

    it('answers 400 when the line would pass 30 units (BR-CRT-02)', async () => {
      const shirt = await variant();
      const cartId = await guestCart();
      await addTo(cartId, shirt.id, 25).expect(200);

      const response = await addTo(cartId, shirt.id, 6).expect(400);

      expect(response.body.errors).toEqual([
        {
          field: 'quantity',
          code: 'lineQuantity',
          message: 'La línea quedaría con más de 30 unidades.',
        },
      ]);
    });

    it('answers 409 variant-not-sellable for a variant unknown, unpublished, discontinued or without a price, the same way', async () => {
      const cartId = await guestCart();
      const draft = await variant({ status: 'DRAFT' });
      const discontinued = await variant({ variantStatus: 'DISCONTINUED' });
      const unpriced = await variant({ price: null });

      for (const variantId of [
        newId(),
        draft.id,
        discontinued.id,
        unpriced.id,
      ]) {
        const response = await addTo(cartId, variantId).expect(409);
        expect(response.body).toMatchObject({
          type: '/problems/variant-not-sellable',
          variantIds: [variantId],
        });
      }
    });

    it('keeps a line that stopped being sellable, but only lets it be removed (ADR-0131)', async () => {
      const shirt = await variant();
      const cartId = await guestCart();
      await addTo(cartId, shirt.id, 2).expect(200);
      await prisma.product.update({
        where: { id: shirt.productId },
        data: { status: 'ARCHIVED' },
      });

      const view = await http().get(`/v1/carts/${cartId}`).expect(200);
      await http()
        .patch(`/v1/carts/${cartId}/lines/${shirt.id}`)
        .send({ quantity: 1 })
        .expect(409);

      expect(view.body).toMatchObject({
        itemCount: 2,
        subtotal: { amount: 0, currency: 'MXN' },
        lines: [
          {
            sellable: false,
            canFulfill: false,
            unitPrice: null,
            lineTotal: null,
          },
        ],
      });
      await http().delete(`/v1/carts/${cartId}/lines/${shirt.id}`).expect(200);
    });

    it('answers 409 cart-line-limit-reached past 100 different variants (ADR-0131)', async () => {
      const shirt = await variant();
      const cartId = await guestCart();
      await prisma.cartLine.createMany({
        data: Array.from({ length: 100 }, () => ({
          cartId,
          variantId: newId(),
          quantity: 1,
        })),
      });

      const response = await addTo(cartId, shirt.id).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/cart-line-limit-reached',
        limit: 100,
      });
    });

    it('answers 409 cart-not-active with its status for a cart an order used', async () => {
      const shirt = await variant();
      const cartId = await guestCart();
      await prisma.cart.update({
        where: { id: cartId },
        data: { status: 'CHECKED_OUT' },
      });

      const response = await addTo(cartId, shirt.id).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/cart-not-active',
        cartStatus: 'CHECKED_OUT',
      });
      expect(
        (await http().get(`/v1/carts/${cartId}`).expect(200)).body.status,
      ).toBe('CHECKED_OUT');
    });

    it('answers 404 for an unknown or malformed id, a missing line, and a cart with an owner', async () => {
      const shirt = await variant();
      const owned = (
        await http()
          .post('/v1/me/cart/lines')
          .set(customerToken())
          .send({ variantId: shirt.id, quantity: 1 })
          .expect(201)
      ).body.id as string;
      const cartId = await guestCart();

      await http().get(`/v1/carts/${newId()}`).expect(404);
      await http().get('/v1/carts/no-es-un-id').expect(404);
      await http().get(`/v1/carts/${owned}`).expect(404);
      await addTo(owned, shirt.id).expect(404);
      await http()
        .patch(`/v1/carts/${cartId}/lines/${shirt.id}`)
        .send({ quantity: 2 })
        .expect(404);
    });
  });

  describe('staff accounts (BR-CRT-08, E-09)', () => {
    it('cannot create or change a cart, but can read a guest cart', async () => {
      const shirt = await variant();
      const cartId = await guestCart();

      for (const response of [
        await http().post('/v1/carts').set(staffToken).expect(403),
        await http()
          .post(`/v1/carts/${cartId}/lines`)
          .set(staffToken)
          .send({ variantId: shirt.id, quantity: 1 })
          .expect(403),
        await http().get('/v1/me/cart').set(staffToken).expect(403),
        await http()
          .post('/v1/me/cart/merge')
          .set(staffToken)
          .send({ guestCartId: cartId })
          .expect(403),
      ]) {
        expect(response.body.type).toBe('/problems/staff-cannot-purchase');
      }
      await http().get(`/v1/carts/${cartId}`).set(staffToken).expect(200);
    });
  });

  describe('customer cart (UC-CRT-01 to 05)', () => {
    it('needs a signed-in account', async () => {
      await http().get('/v1/me/cart').expect(401);
    });

    it('starts empty, opens with the first line (201), and then answers 200', async () => {
      const [shirt, cap] = [await variant(), await variant({ price: 19_900 })];
      const me = customerToken();

      expect(
        (await http().get('/v1/me/cart').set(me).expect(200)).body,
      ).toEqual({
        id: null,
        status: 'ACTIVE',
        lines: [],
        itemCount: 0,
        subtotal: { amount: 0, currency: 'MXN' },
        lastActivityAt: null,
      });
      const first = await http()
        .post('/v1/me/cart/lines')
        .set(me)
        .send({ variantId: shirt.id, quantity: 1 })
        .expect(201);
      const second = await http()
        .post('/v1/me/cart/lines')
        .set(me)
        .send({ variantId: cap.id, quantity: 2 })
        .expect(200);
      await http()
        .patch(`/v1/me/cart/lines/${cap.id}`)
        .set(me)
        .send({ quantity: 3 })
        .expect(200);
      const removed = await http()
        .delete(`/v1/me/cart/lines/${shirt.id}`)
        .set(me)
        .expect(200);

      expect(first.body.id).toMatch(UUID_V4);
      expect(second.body.id).toBe(first.body.id);
      expect(removed.body).toMatchObject({
        id: first.body.id,
        itemCount: 3,
        subtotal: { amount: 59_700, currency: 'MXN' },
      });
    });
  });

  describe('merge (UC-CRT-06, ADR-0059)', () => {
    const merge = (token: Record<string, string>, guestCartId: string) =>
      http().post('/v1/me/cart/merge').set(token).send({ guestCartId });

    it('gives the guest cart to a customer without one', async () => {
      const shirt = await variant();
      const guest = await guestCart();
      await addTo(guest, shirt.id, 2).expect(200);
      const me = customerToken();

      const response = await merge(me, guest).expect(200);

      expect(response.body).toMatchObject({ id: guest, itemCount: 2 });
      await http().get(`/v1/carts/${guest}`).expect(404);
      expect((await merge(me, guest).expect(200)).body.itemCount).toBe(2);
    });

    it('adds the guest lines up to 30 each, leaves the guest cart MERGED, and never adds them twice', async () => {
      const [shirt, cap] = [await variant(), await variant()];
      const me = customerToken();
      await http()
        .post('/v1/me/cart/lines')
        .set(me)
        .send({ variantId: shirt.id, quantity: 25 })
        .expect(201);
      const guest = await guestCart();
      await addTo(guest, shirt.id, 10).expect(200);
      await addTo(guest, cap.id, 1).expect(200);

      const merged = await merge(me, guest).expect(200);
      const again = await merge(me, guest).expect(200);

      expect(
        merged.body.lines.map(
          (line: { variantId: string; quantity: number }) => [
            line.variantId,
            line.quantity,
          ],
        ),
      ).toEqual([
        [shirt.id, 30],
        [cap.id, 1],
      ]);
      expect(again.body).toEqual(merged.body);
      expect(
        (await http().get(`/v1/carts/${guest}`).expect(200)).body.status,
      ).toBe('MERGED');
      await addTo(guest, shirt.id).expect(409);
    });

    it('answers 404 for a cart unknown or of another customer, and 409 for one merged into another account', async () => {
      const shirt = await variant();
      const other = customerToken();
      const owned = (
        await http()
          .post('/v1/me/cart/lines')
          .set(other)
          .send({ variantId: shirt.id, quantity: 1 })
          .expect(201)
      ).body.id as string;
      const guest = await guestCart();
      await addTo(guest, shirt.id).expect(200);
      await merge(customerToken(), guest).expect(200);
      const second = await guestCart();
      await merge(other, second).expect(200);

      await merge(customerToken(), newId()).expect(404);
      await merge(customerToken(), owned).expect(404);
      const response = await merge(customerToken(), second).expect(409);
      expect(response.body).toMatchObject({
        type: '/problems/cart-not-active',
        cartStatus: 'MERGED',
      });
    });
  });
});
