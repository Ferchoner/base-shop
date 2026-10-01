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

/** A guest looks up their order (e2e, T-185, UC-ORD-04, ADR-0020, ADR-0138). */
describe('Guest order lookup (e2e, T-185)', () => {
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
  const lookup = (body: object, user?: AuthenticatedUser) => {
    const call = http().post('/v1/orders/lookup');
    return (user === undefined ? call : call.set(signedInAs(user))).send(body);
  };

  /** A published variant priced at $100.00, with 5 units. */
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
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: 5 },
    });
    return id;
  }

  /** A guest order of one unit, placed with `cliente@example.com`. */
  async function guestOrder(): Promise<{ publicCode: string; cartId: string }> {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId: await variant(), quantity: 1 })
      .expect(200);
    const { body } = await http()
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        expectedTotal: 19_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    return { publicCode: body.publicCode as string, cartId };
  }

  /** A verified customer with an order of one unit. */
  async function customerOrder(): Promise<{
    email: string;
    publicCode: string;
  }> {
    const id = newId();
    const email = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: new Date(),
      },
    });
    const customer: AuthenticatedUser = {
      id,
      type: 'CUSTOMER',
      permissions: [],
      mustChangePassword: false,
      sessionId: newId(),
    };
    await http()
      .post('/v1/me/cart/lines')
      .set(signedInAs(customer))
      .send({ variantId: await variant(), quantity: 1 })
      .expect(201);
    const { body } = await http()
      .post('/v1/me/orders')
      .set(signedInAs(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal: 19_900 })
      .expect(201);
    return { email, publicCode: body.publicCode as string };
  }

  const staff: AuthenticatedUser = {
    id: newId(),
    type: 'STAFF',
    permissions: ['orders.read'],
    mustChangePassword: false,
    sessionId: newId(),
  };

  it('shows a guest their order with its email and code, however they type them', async () => {
    const { publicCode } = await guestOrder();

    const { body } = await lookup({
      contactEmail: ' Cliente@Example.COM ',
      publicCode,
    }).expect(200);

    expect(body).toMatchObject({
      publicCode,
      status: 'PENDING_PAYMENT',
      grandTotal: { amount: 19_900, currency: 'MXN' },
      paymentDueAt: expect.any(String),
      payment: null,
      lines: [expect.objectContaining({ quantity: 1 })],
    });
    for (const typed of [
      publicCode.toLowerCase(),
      publicCode.replace('-', ''),
    ]) {
      expect(
        (
          await lookup({
            contactEmail: 'cliente@example.com',
            publicCode: typed,
          }).expect(200)
        ).body,
      ).toEqual(body);
    }
  });

  it("answers the same 404 when the order does not exist, the email is another, the code cannot exist or the order is a customer's (BR-ORD-11)", async () => {
    const { publicCode } = await guestOrder();
    const ofCustomer = await customerOrder();

    const answers = [];
    for (const body of [
      { contactEmail: 'cliente@example.com', publicCode: 'ZZZZ-ZZZZ' },
      { contactEmail: 'otro@example.com', publicCode },
      { contactEmail: 'cliente@example.com', publicCode: 'no-es-un-codigo' },
      { contactEmail: ofCustomer.email, publicCode: ofCustomer.publicCode },
    ]) {
      // Each response has its own correlation ID; everything else must be the same.
      const { correlationId, ...answer } = (await lookup(body).expect(404))
        .body as { correlationId: string };
      expect(correlationId).toEqual(expect.any(String));
      answers.push(answer);
    }

    expect(answers[0]).toMatchObject({ type: '/problems/not-found' });
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(JSON.stringify(answers[0])).not.toContain('ZZZZ');
  });

  it('answers 400 without an email or a code, or with an email that is not one', async () => {
    const { publicCode } = await guestOrder();

    for (const body of [
      {},
      { publicCode },
      { contactEmail: 'cliente@example.com' },
      { contactEmail: 'no-es-un-email', publicCode },
      { contactEmail: 'cliente@example.com', publicCode: '  ' },
      { contactEmail: 'cliente@example.com', publicCode: 1234 },
      { contactEmail: 'cliente@example.com', publicCode: 'x'.repeat(101) },
    ]) {
      const response = await lookup(body).expect(400);
      expect(response.body.type).toBe('/problems/validation-error');
    }
    // A code of another type reports the type rule, first (ADR-0130).
    const numeric = await lookup({
      contactEmail: 'cliente@example.com',
      publicCode: 1234,
    }).expect(400);
    expect(numeric.body.errors).toEqual([
      expect.objectContaining({ field: 'publicCode', code: 'isString' }),
    ]);
  });

  it('lets the staff look up a guest order, but not buy nor pay as a guest (ADR-0138)', async () => {
    const { publicCode, cartId } = await guestOrder();

    await lookup(
      { contactEmail: 'cliente@example.com', publicCode },
      staff,
    ).expect(200);
    const placing = await http()
      .post('/v1/orders')
      .set(signedInAs(staff))
      .set('Idempotency-Key', randomUUID())
      .send({
        cartId,
        contactEmail: 'cliente@example.com',
        shippingAddress: ADDRESS,
        expectedTotal: 19_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(403);
    const paying = await http()
      .post(`/v1/orders/${publicCode}/payments`)
      .set(signedInAs(staff))
      .set('Idempotency-Key', randomUUID())
      .send({ cartId, provider: 'MANUAL' })
      .expect(403);

    expect([placing.body.type, paying.body.type]).toEqual([
      '/problems/staff-cannot-purchase',
      '/problems/staff-cannot-purchase',
    ]);
  });
});
