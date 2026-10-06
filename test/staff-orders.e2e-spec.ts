import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { STAFF_PLACEMENT_ENDPOINT } from '../src/modules/ordering/infrastructure/idempotency-placement-responses.js';
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
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

/** The orders the staff places in the physical store over HTTP (T-187 part a, UC-ORD-12 and 13, ADR-0161). */
describe('Orders of the staff in the store (e2e, T-187)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sent: EmailMessage[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailSender)
      .useValue({
        send: (message: EmailMessage) => {
          sent.push(message);
          return Promise.resolve();
        },
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
    sent.length = 0;
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'orders.' } },
          { action: { startsWith: 'payments.' } },
        ],
      },
    });
    await prisma.paymentAttempt.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.idempotencyKey.deleteMany();
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
  /** As the seeded Vendedor role (ADR-0161). */
  const seller = staff(
    'catalog.read',
    'inventory.read',
    'orders.read',
    'orders.place',
    'customers.read',
  );

  /** The warehouse of the store, active, after the main one by priority. */
  async function storeWarehouse(): Promise<string> {
    const id = newId();
    await prisma.warehouse.create({
      data: {
        id,
        code: 'TIENDA',
        name: 'Tienda',
        status: 'ACTIVE',
        priority: 2,
      },
    });
    return id;
  }

  /** A published variant priced at $100.00, with the units of each warehouse. */
  async function variant(units: [string, number][]): Promise<string> {
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
    for (const [warehouseId, onHand] of units) {
      await prisma.stockItem.create({
        data: { id: newId(), variantId: id, warehouseId, onHand },
      });
    }
    return id;
  }

  /** A verified customer with a saved address. */
  async function customerWithAddress(): Promise<{
    id: string;
    email: string;
    addressId: string;
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
    const addressId = newId();
    await prisma.customerAddress.create({
      data: { id: addressId, userId: id, ...ADDRESS, isDefault: true },
    });
    return { id, email, addressId };
  }

  /** A guest order of `units` of the variant from the warehouse: $100.00 a unit plus $99.00 of shipping. */
  const guestOrder = (
    variantId: string,
    units: number,
    warehouseId: string,
  ) => ({
    lines: [{ variantId, quantity: units }],
    warehouseId,
    contactEmail: 'Cliente@Example.com',
    privacyNoticeVersion: '2026-09',
    shippingAddress: ADDRESS,
    expectedTotal: units * 10_000 + 9_900,
  });

  const place = (
    body: object,
    by: AuthenticatedUser = seller,
    key = randomUUID(),
  ) =>
    http()
      .post('/v1/admin/orders')
      .set(signedInAs(by))
      .set('Idempotency-Key', key)
      .send(body);

  it('quotes an order in the store with the stock of the warehouse the staff chose', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([
      [MAIN, 10],
      [store, 1],
    ]);

    const { body } = await http()
      .post('/v1/admin/orders/quote')
      .set(signedInAs(seller))
      .send({ lines: [{ variantId: shirt, quantity: 2 }], warehouseId: store })
      .expect(200);

    expect(body).toMatchObject({
      lines: [
        { variantId: shirt, quantity: 2, sellable: true, canFulfill: false },
      ],
      subtotal: { amount: 20_000 },
      grandTotal: { amount: 29_900 },
      readyToPlace: false,
    });
    await http()
      .post('/v1/admin/orders/quote')
      .set(signedInAs(seller))
      .send({
        lines: [{ variantId: shirt, quantity: 1 }],
        warehouseId: newId(),
      })
      .expect(404);
  });

  it('places a store order for a guest, with the warehouse and who placed it, and repeats it for the same key', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([
      [MAIN, 10],
      [store, 5],
    ]);
    const key = randomUUID();

    const response = await place(
      guestOrder(shirt, 2, store),
      seller,
      key,
    ).expect(201);

    const { body } = response;
    expect(response.headers.location).toBe(`/v1/admin/orders/${body.id}`);
    expect(body).toMatchObject({
      status: 'PENDING_PAYMENT',
      channel: 'STORE',
      placedBy: seller.id,
      warehouseId: store,
      customerId: null,
      contactEmail: 'cliente@example.com',
      grandTotal: { amount: 29_900 },
      statusHistory: [
        { fromStatus: null, toStatus: 'PENDING_PAYMENT', actorId: seller.id },
      ],
    });
    const repeated = await place(
      guestOrder(shirt, 2, store),
      seller,
      key,
    ).expect(201);
    expect(repeated.body).toEqual(body);
    expect(await prisma.order.count()).toBe(1);
    // Kept where the anonymization looks for it (ADR-0161).
    expect(
      await prisma.idempotencyKey.findMany({
        where: { scopeId: seller.id },
        select: { endpoint: true, responseBody: true },
      }),
    ).toEqual([
      {
        endpoint: STAFF_PLACEMENT_ENDPOINT,
        responseBody: expect.objectContaining({
          body: expect.objectContaining({ id: body.id }),
        }),
      },
    ]);
    await place(guestOrder(shirt, 1, store), seller, key).expect(422);
    expect(
      await prisma.stockItem.findMany({
        where: { variantId: shirt },
        select: { warehouseId: true, reserved: true },
        orderBy: { reserved: 'asc' },
      }),
    ).toEqual([
      { warehouseId: MAIN, reserved: 0 },
      { warehouseId: store, reserved: 2 },
    ]);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'orders.place',
          resourceId: body.id,
          actorId: seller.id,
        },
      }),
    ).toBe(1);
  });

  it('places a store order for a customer, with a saved address and the account email', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([[store, 5]]);
    const customer = await customerWithAddress();

    const { body } = await place({
      lines: [{ variantId: shirt, quantity: 1 }],
      warehouseId: store,
      customerId: customer.id,
      addressId: customer.addressId,
      expectedTotal: 19_900,
    }).expect(201);

    expect(body).toMatchObject({
      channel: 'STORE',
      customerId: customer.id,
      contactEmail: customer.email,
      shippingAddress: { street: ADDRESS.street },
    });
  });

  it('checks the buyer, the address and the lines, before anything else', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([[store, 5]]);
    const customer = await customerWithAddress();
    const guest = guestOrder(shirt, 1, store);
    const { contactEmail, privacyNoticeVersion, ...noBuyer } = guest;

    for (const [body, field, code] of [
      [{ ...guest, customerId: customer.id }, 'customerId', 'exactlyOneBuyer'],
      [noBuyer, 'customerId', 'exactlyOneBuyer'],
      [{ ...noBuyer, contactEmail }, 'privacyNoticeVersion', 'isDefined'],
      [
        { ...noBuyer, customerId: customer.id, privacyNoticeVersion },
        'privacyNoticeVersion',
        'onlyForGuest',
      ],
      [
        { ...guest, shippingAddress: undefined, addressId: customer.addressId },
        'addressId',
        'onlyWithCustomer',
      ],
      [
        { ...guest, addressId: customer.addressId },
        'addressId',
        'exactlyOneAddress',
      ],
      [
        {
          ...guest,
          lines: [
            { variantId: shirt, quantity: 1 },
            { variantId: shirt, quantity: 1 },
          ],
        },
        'lines',
        'arrayUnique',
      ],
      [
        { ...guest, lines: [{ variantId: shirt, quantity: 31 }] },
        'lines[0].quantity',
        'max',
      ],
      [{ ...guest, lines: [] }, 'lines', 'arrayMinSize'],
    ] as const) {
      const { body: problem } = await place(body).expect(400);
      expect(problem.errors).toEqual([
        expect.objectContaining({ field, code }),
      ]);
    }
    await http()
      .post('/v1/admin/orders')
      .set(signedInAs(seller))
      .send(guest)
      .expect(400)
      .expect(({ body }) =>
        expect(body.type).toMatch(/idempotency-key-missing$/),
      );
    expect(await prisma.order.count()).toBe(0);
  });

  it('answers 404 for a warehouse that is not active, and 409 with what the chosen one leaves out', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([
      [MAIN, 10],
      [store, 1],
    ]);
    const inactive = newId();
    await prisma.warehouse.create({
      data: { id: inactive, code: 'VIEJO', name: 'Viejo', status: 'INACTIVE' },
    });

    await place(guestOrder(shirt, 1, inactive)).expect(404);
    const { body } = await place(guestOrder(shirt, 2, store)).expect(409);
    expect(body).toMatchObject({
      type: expect.stringMatching(/insufficient-stock$/),
      lines: [{ variantId: shirt, canFulfill: false }],
    });
    expect(await prisma.order.count()).toBe(0);
  });

  it('lets only orders.place place them, and the seller cannot record their payment', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([[store, 5]]);
    const manager = staff('orders.read', 'orders.manage');

    await place(guestOrder(shirt, 1, store), manager).expect(403);
    await http()
      .post('/v1/admin/orders/quote')
      .set(signedInAs(manager))
      .send({ lines: [{ variantId: shirt, quantity: 1 }], warehouseId: store })
      .expect(403);
    const { body } = await place(guestOrder(shirt, 1, store)).expect(201);
    await http()
      .post(`/v1/admin/orders/${body.id}/manual-capture`)
      .set(signedInAs(seller))
      .send({ reference: 'Ticket 00452' })
      .expect(403);
  });

  it('lists the orders of a channel and of the staff member who placed them', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([[store, 10]]);
    const other = staff('orders.place', 'orders.read');
    const { body: mine } = await place(guestOrder(shirt, 1, store)).expect(201);
    const { body: theirs } = await place(
      guestOrder(shirt, 1, store),
      other,
    ).expect(201);

    const list = async (query: string) =>
      (
        await http()
          .get(`/v1/admin/orders?${query}`)
          .set(signedInAs(seller))
          .expect(200)
      ).body.data.map(({ id }: { id: string }) => id);

    expect(await list(`placedBy=${seller.id}`)).toEqual([mine.id]);
    expect((await list('channel=STORE')).sort()).toEqual(
      [mine.id, theirs.id].sort(),
    );
    expect(await list('channel=ONLINE')).toEqual([]);
    const { body: summary } = await http()
      .get(`/v1/admin/orders?placedBy=${other.id}`)
      .set(signedInAs(seller))
      .expect(200);
    expect(summary.data[0]).toMatchObject({
      channel: 'STORE',
      placedBy: other.id,
      warehouseId: store,
    });
    await http()
      .get('/v1/admin/orders?channel=TIENDA')
      .set(signedInAs(seller))
      .expect(400);
  });

  it('emails the received order without the hold nor how to pay in the store, since the customer is there', async () => {
    const store = await storeWarehouse();
    const shirt = await variant([[store, 5]]);

    await place(guestOrder(shirt, 1, store)).expect(201);
    await idle();

    expect(sent).toEqual([
      expect.objectContaining({ to: 'cliente@example.com' }),
    ]);
    expect(sent[0].text).toContain('Lo enviaremos a:');
    expect(sent[0].text).not.toContain('Para pagar');
    expect(sent[0].text).not.toContain('Apartamos');
  });

  describe('a sale at the counter, handed over in the store (UC-ORD-14, ADR-0161)', () => {
    const cashier = staff('orders.read', 'payments.manage');

    /** A counter sale of `units` of the variant: $100.00 a unit, without shipping nor, unless given, buyer data. */
    const counterSale = (
      variantId: string,
      units: number,
      warehouseId: string,
      buyer: object = {},
    ) => ({
      lines: [{ variantId, quantity: units }],
      warehouseId,
      fulfillment: 'IN_STORE',
      expectedTotal: units * 10_000,
      ...buyer,
    });

    const read = async (id: string) =>
      (
        await http()
          .get(`/v1/admin/orders/${id}`)
          .set(signedInAs(seller))
          .expect(200)
      ).body;

    it('sells at the counter without data: quotes, places, collects and hands the goods over', async () => {
      const store = await storeWarehouse();
      const shirt = await variant([[store, 5]]);

      const { body: quote } = await http()
        .post('/v1/admin/orders/quote')
        .set(signedInAs(seller))
        .send({
          lines: [{ variantId: shirt, quantity: 2 }],
          warehouseId: store,
          fulfillment: 'IN_STORE',
        })
        .expect(200);
      expect(quote).toMatchObject({
        shippingCost: { amount: 0 },
        grandTotal: { amount: 20_000 },
        freeShippingThreshold: null,
        estimatedDelivery: null,
        readyToPlace: true,
      });

      const { body: placed } = await place(counterSale(shirt, 2, store)).expect(
        201,
      );
      expect(placed).toMatchObject({
        status: 'PENDING_PAYMENT',
        channel: 'STORE',
        fulfillment: 'IN_STORE',
        customerId: null,
        contactEmail: null,
        shippingAddress: null,
        estimatedDelivery: null,
        shippingCost: { amount: 0 },
        grandTotal: { amount: 20_000 },
      });

      await http()
        .post(`/v1/admin/orders/${placed.id}/manual-capture`)
        .set(signedInAs(cashier))
        .send({ reference: 'Ticket 00460', method: 'CASH' })
        .expect(200);
      await idle();
      const paid = await read(placed.id);
      expect(paid).toMatchObject({
        status: 'PAID',
        shipment: null,
        payment: { status: 'CAPTURED', method: 'CASH' },
      });

      const { body: delivered } = await http()
        .post(`/v1/admin/orders/${placed.id}/hand-over`)
        .set(signedInAs(seller))
        .send({ version: paid.version })
        .expect(200);
      expect(delivered).toMatchObject({
        status: 'DELIVERED',
        deliveredAt: expect.any(String),
        shipment: null,
      });
      expect(delivered.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'PAID',
        toStatus: 'DELIVERED',
        actorId: seller.id,
      });
      // Nobody to email.
      expect(sent).toEqual([]);
    });

    it('hands over only a paid order of the counter, at its version, and only with orders.place', async () => {
      const store = await storeWarehouse();
      const shirt = await variant([[store, 5]]);
      const { body: pending } = await place(
        counterSale(shirt, 1, store),
      ).expect(201);
      const { body: shipped } = await place(guestOrder(shirt, 1, store)).expect(
        201,
      );
      const handOver = (id: string, version: number, by = seller) =>
        http()
          .post(`/v1/admin/orders/${id}/hand-over`)
          .set(signedInAs(by))
          .send({ version });

      await handOver(pending.id, 1).expect(409);
      for (const id of [shipped.id]) {
        await http()
          .post(`/v1/admin/orders/${id}/manual-capture`)
          .set(signedInAs(cashier))
          .send({ reference: 'Ticket 00461' })
          .expect(200);
      }
      await idle();
      const shippedNow = await read(shipped.id);
      const { body: problem } = await handOver(
        shipped.id,
        shippedNow.version,
      ).expect(409);
      expect(problem.type).toMatch(/invalid-state-transition$/);
      await handOver(pending.id, 7).expect(409);
      await handOver(pending.id, 1, cashier).expect(403);
      await handOver(newId(), 1).expect(404);
      await http()
        .post(`/v1/admin/orders/${pending.id}/hand-over`)
        .set(signedInAs(seller))
        .send({})
        .expect(400);
    });

    it('takes the buyer data when given, and refuses an address or a stray privacy notice', async () => {
      const store = await storeWarehouse();
      const shirt = await variant([[store, 5]]);
      const customer = await customerWithAddress();

      for (const [body, field, code] of [
        [
          counterSale(shirt, 1, store, { shippingAddress: ADDRESS }),
          'shippingAddress',
          'onlyForShipping',
        ],
        [
          counterSale(shirt, 1, store, {
            customerId: customer.id,
            addressId: customer.addressId,
          }),
          'addressId',
          'onlyForShipping',
        ],
        [
          counterSale(shirt, 1, store, { privacyNoticeVersion: '2026-09' }),
          'privacyNoticeVersion',
          'onlyForGuest',
        ],
        [
          {
            ...counterSale(shirt, 1, store),
            fulfillment: 'SHIPPING',
            shippingAddress: ADDRESS,
            expectedTotal: 19_900,
          },
          'customerId',
          'exactlyOneBuyer',
        ],
        [
          { ...counterSale(shirt, 1, store), fulfillment: 'RECOGER' },
          'fulfillment',
          'isIn',
        ],
      ] as const) {
        const { body: problem } = await place(body).expect(400);
        expect(problem.errors).toEqual([
          expect.objectContaining({ field, code }),
        ]);
      }
      const { body: forCustomer } = await place(
        counterSale(shirt, 1, store, { customerId: customer.id }),
      ).expect(201);
      expect(forCustomer).toMatchObject({
        customerId: customer.id,
        contactEmail: customer.email,
        shippingAddress: null,
      });
      // The customer sees it without an address nor a delivery time.
      const { body: mine } = await http()
        .get(`/v1/me/orders/${forCustomer.publicCode}`)
        .set(
          signedInAs({
            id: customer.id,
            type: 'CUSTOMER',
            permissions: [],
            mustChangePassword: false,
            sessionId: newId(),
          }),
        )
        .expect(200);
      expect(mine).toMatchObject({
        fulfillment: 'IN_STORE',
        shippingAddress: null,
        estimatedDelivery: null,
      });
    });

    it('emails a guest of the counter where the goods are delivered, without a delivery time', async () => {
      const store = await storeWarehouse();
      const shirt = await variant([[store, 5]]);

      const { body: placed } = await place(
        counterSale(shirt, 1, store, {
          contactEmail: 'mostrador@example.com',
          privacyNoticeVersion: '2026-09',
        }),
      ).expect(201);
      await http()
        .post(`/v1/admin/orders/${placed.id}/manual-capture`)
        .set(signedInAs(cashier))
        .send({ reference: 'Ticket 00462', method: 'CARD_TERMINAL' })
        .expect(200);
      await idle();

      expect(sent.map(({ to }) => to)).toEqual([
        'mostrador@example.com',
        'mostrador@example.com',
      ]);
      const [received, paid] = sent.map(({ text }) => text);
      expect(received).toContain('Entrega: en la tienda.');
      expect(received).not.toContain('Lo enviaremos a:');
      expect(received).not.toContain('Plazo de entrega');
      expect(paid).toContain('Te entregamos tus productos en la tienda.');
    });
  });
});
