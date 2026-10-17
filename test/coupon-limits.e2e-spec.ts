import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** A small limit, so it is reached in a few requests. */
const TEST_LIMITS = { RATE_LIMIT_COUPON_ATTEMPTS: '3/15m' };

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

/**
 * The codes of coupons nobody has are limited per IP, on every route that takes a coupon; a coupon that applies, or
 * that is refused for another reason, spends nothing (T-200 part c, ADR-0168). The tests share one budget per IP, so
 * they run in order.
 */
describe('Coupon limits (e2e, T-200 part c)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const previous: Record<string, string | undefined> = {};
  const seller = {
    id: newId(),
    type: 'STAFF' as const,
    permissions: ['catalog.read', 'orders.place', 'orders.read'] as const,
    mustChangePassword: false,
    sessionId: newId(),
  };
  let shirt: string;
  let cartId: string;

  beforeAll(async () => {
    for (const [name, value] of Object.entries(TEST_LIMITS)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the limits.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const { PrismaService: Prisma } =
      await import('../src/platform/persistence/prisma.service.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(Prisma);

    const productId = newId();
    shirt = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug: `camisa-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id: shirt,
            sku: `CAM-${shirt.slice(-12)}`.toUpperCase(),
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
        variantId: shirt,
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
      data: { id: newId(), variantId: shirt, warehouseId: MAIN, onHand: 10 },
    });
    await prisma.promotion.create({
      data: {
        id: newId(),
        name: 'Bienvenida',
        percentage: 10,
        online: true,
        inStore: true,
        startsAt: new Date(Date.now() - 86_400_000),
        createdBy: newId(),
        updatedAt: new Date(),
        code: 'HOLA-10',
        minimumSubtotal: 100_000,
      },
    });
    cartId = (await http().post('/v1/carts').expect(201)).body.id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId: shirt, quantity: 1 })
      .expect(200);
  });

  afterAll(async () => {
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.promotion.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const http = () => request(app.getHttpServer());

  const quote = (couponCode?: string) =>
    http()
      .post('/v1/checkout/quote')
      .send(couponCode === undefined ? { cartId } : { cartId, couponCode });

  const staffQuote = (couponCode: string) =>
    http()
      .post('/v1/admin/orders/quote')
      .set(signedInAs({ ...seller, permissions: [...seller.permissions] }))
      .send({
        lines: [{ variantId: shirt, quantity: 1 }],
        warehouseId: MAIN,
        fulfillment: 'IN_STORE',
        couponCode,
      });

  function expectLimited(response: request.Response): void {
    expect(response.status).toBe(429);
    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  }

  it('never counts a coupon refused for another reason than being unknown, nor a request without coupon', async () => {
    // The purchase does not reach the minimum of the coupon.
    for (let call = 0; call < 4; call++) {
      const response = await quote('hola-10').expect(409);
      expect(response.body.reason).toBe('minimumNotMet');
    }
    await quote().expect(200);
  });

  it('stops an IP after its codes nobody has, on any route, and says when to retry', async () => {
    await quote('NADIE').expect(409);
    await staffQuote('NINGUNO').expect(409);
    await quote('TAMPOCO').expect(409);

    expectLimited(await quote('OTRO-MAS'));
    // A code that exists waits too, on every route, while a request without coupon goes on.
    expectLimited(await quote('hola-10'));
    expectLimited(await staffQuote('hola-10'));
    await quote().expect(200);
  });
});
