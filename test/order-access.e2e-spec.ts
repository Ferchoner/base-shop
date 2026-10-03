import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import type { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import type { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { type EmailMessage, newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The IP budget (10 per hour) is tested apart, in order-access-limits.e2e-spec.ts. */
const TEST_ENVIRONMENT = { RATE_LIMIT_ORDER_ACCESS_IP: '1000/1h' };

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

/** A guest who lost the code of their order opens their orders with a link sent to their email (e2e, T-186). */
describe('Access link to the guest orders (e2e, T-186)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let dispatcher: DomainEventDispatcher;
  const sent: EmailMessage[] = [];
  /** While set, emails wait for it before they go. */
  let held: Promise<void> | null = null;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the variables.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const { PrismaService } =
      await import('../src/platform/persistence/prisma.service.js');
    const { DomainEventDispatcher } =
      await import('../src/platform/events/domain-event-dispatcher.js');
    const { EmailSender } = await import('../src/shared-kernel/index.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailSender)
      .useValue({
        send: async (message: EmailMessage) => {
          await held;
          sent.push(message);
        },
      })
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    dispatcher = app.get(DomainEventDispatcher);
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
    await dispatcher.whenIdle();
    sent.length = 0;
    await prisma.orderAccessToken.deleteMany();
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
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const http = () => request(app.getHttpServer());
  const requestLink = (body: object, user?: AuthenticatedUser) => {
    const call = http().post('/v1/orders/access-links');
    return (user === undefined ? call : call.set(signedInAs(user))).send(body);
  };
  const access = (body: object, user?: AuthenticatedUser) => {
    const call = http().post('/v1/orders/access');
    return (user === undefined ? call : call.set(signedInAs(user))).send(body);
  };

  /** The access links sent, without the emails of the orders. */
  const links = () =>
    sent.filter(({ subject }) => subject === 'Consulta tus pedidos');

  /** An email of its own for a test: each one has a budget of 3 requests per hour. */
  const someEmail = () => `${newId()}@example.com`;

  /** The token of the last access link sent to `to`, once the links asked for went out. */
  async function lastToken(to: string): Promise<string> {
    await dispatcher.whenIdle();
    const message = links()
      .filter((email) => email.to === to)
      .at(-1);
    const token = /order-access\?token=([\w-]+)/.exec(message?.text ?? '');
    if (token === null) throw new Error(`No access link to ${to}`);
    return token[1];
  }

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

  /** A guest order of one unit, placed with `contactEmail`, once its email went out; answers its public code. */
  async function guestOrder(contactEmail: string): Promise<string> {
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
        contactEmail,
        shippingAddress: ADDRESS,
        expectedTotal: 19_900,
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    await dispatcher.whenIdle();
    return body.publicCode as string;
  }

  /** A verified customer with an order of one unit; answers their email. */
  async function customerOrder(): Promise<string> {
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
    await http()
      .post('/v1/me/orders')
      .set(signedInAs(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: ADDRESS, expectedTotal: 19_900 })
      .expect(201);
    return email;
  }

  const staff: AuthenticatedUser = {
    id: newId(),
    type: 'STAFF',
    permissions: [],
    mustChangePassword: false,
    sessionId: newId(),
  };

  it('never stores an email in the domain events: not the access request, nor the events of a guest order (ADR-0150)', async () => {
    const email = someEmail();
    await guestOrder(email);
    await requestLink({ contactEmail: email }).expect(202);
    await dispatcher.whenIdle();

    const [{ withEmail }] = await prisma.$queryRaw<{ withEmail: number }[]>`
      SELECT count(*)::int AS "withEmail" FROM domain_events WHERE payload::text LIKE '%@%'`;
    expect(withEmail).toBe(0);
    expect(
      await prisma.storedDomainEvent.count({
        where: { eventType: 'OrderAccessRequested' },
      }),
    ).toBe(0);
    expect(
      await prisma.storedDomainEvent.count({
        where: { eventType: 'OrderPlaced' },
      }),
    ).toBeGreaterThan(0);
  });

  it('answers 202 the same whether the email has guest orders or not, and sends the link only to one that has', async () => {
    await guestOrder('cliente@example.com');
    const customerEmail = await customerOrder();

    const answers = [];
    for (const contactEmail of [
      ' Cliente@Example.COM ',
      'nadie@example.com',
      customerEmail,
    ]) {
      answers.push((await requestLink({ contactEmail }).expect(202)).body);
    }
    await dispatcher.whenIdle();

    expect(answers).toEqual([{}, {}, {}]);
    expect(links()).toEqual([
      {
        to: 'cliente@example.com',
        subject: 'Consulta tus pedidos',
        text: expect.stringContaining(
          'http://localhost:5173/order-access?token=',
        ),
      },
    ]);
  });

  it('answers before the link is sent (ADR-0148)', async () => {
    const email = someEmail();
    await guestOrder(email);
    let release = () => {};
    held = new Promise((resolve) => {
      release = resolve;
    });
    try {
      // Waiting for the email here would never end: it goes out only after the release.
      await requestLink({ contactEmail: email }).expect(202);

      expect(links()).toEqual([]);
    } finally {
      release();
      held = null;
    }
    expect(await lastToken(email)).toEqual(expect.any(String));
  });

  it('opens once the summaries of the guest orders of the email, newest first, whose detail the lookup shows', async () => {
    const email = someEmail();
    const older = await guestOrder(email);
    const newer = await guestOrder(email);
    await guestOrder(someEmail());
    await requestLink({ contactEmail: email }).expect(202);
    const token = await lastToken(email);

    const { body } = await access({ token }).expect(200);

    expect(body).toEqual({
      contactEmail: email,
      orders: [
        expect.objectContaining({ publicCode: newer }),
        expect.objectContaining({ publicCode: older }),
      ],
    });
    expect(body.orders[0]).toMatchObject({
      status: 'PENDING_PAYMENT',
      contactEmail: email,
      itemCount: 1,
      grandTotal: { amount: 19_900, currency: 'MXN' },
      payment: null,
      shipment: null,
    });
    expect(body.orders[0]).not.toHaveProperty('lines');
    expect(body.orders[0]).not.toHaveProperty('shippingAddress');
    await http()
      .post('/v1/orders/lookup')
      .send({ contactEmail: body.contactEmail, publicCode: newer })
      .expect(200);
    const again = await access({ token }).expect(400);
    expect(again.body.type).toBe('/problems/invalid-or-expired-token');
  });

  it('works for a staff account too, as the lookup does', async () => {
    const email = someEmail();
    await guestOrder(email);

    await requestLink({ contactEmail: email }, staff).expect(202);
    const { body } = await access(
      { token: await lastToken(email) },
      staff,
    ).expect(200);

    expect(body.orders).toHaveLength(1);
  });

  it('replaces the earlier link with a newer one', async () => {
    const email = someEmail();
    await guestOrder(email);
    await requestLink({ contactEmail: email }).expect(202);
    const first = await lastToken(email);
    await requestLink({ contactEmail: email }).expect(202);
    const second = await lastToken(email);

    const replaced = await access({ token: first }).expect(400);
    await access({ token: second }).expect(200);

    expect(replaced.body.type).toBe('/problems/invalid-or-expired-token');
  });

  it('answers 400 without an email or a token, or with an email that is not one', async () => {
    for (const body of [{}, { contactEmail: 'no-es-un-email' }]) {
      const response = await requestLink(body).expect(400);
      expect(response.body.type).toBe('/problems/validation-error');
    }
    for (const body of [{}, { token: '' }, { token: 'x'.repeat(257) }]) {
      const response = await access(body).expect(400);
      expect(response.body.type).toBe('/problems/validation-error');
    }
    const unknown = await access({ token: 'no-existe' }).expect(400);
    expect(unknown.body.type).toBe('/problems/invalid-or-expired-token');
  });

  it('takes at most 3 requests per email and hour, however it is typed', async () => {
    for (const contactEmail of [
      'limite@example.com',
      'LIMITE@example.com',
      ' limite@example.com',
    ]) {
      await requestLink({ contactEmail }).expect(202);
    }

    const response = await requestLink({
      contactEmail: 'Limite@Example.com',
    }).expect(429);

    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    await requestLink({ contactEmail: someEmail() }).expect(202);
  });
});
