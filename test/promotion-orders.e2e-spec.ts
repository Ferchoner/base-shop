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

/** The promotions of orders over HTTP (T-200 part b, UC-PRM-04, ADR-0168). */
describe('Promotions in orders (e2e, T-200 part b)', () => {
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
  const administrator = staff(
    'promotions.manage',
    'promotions.read',
    'orders.read',
  );
  /** As the seeded Vendedor role, which sells at the counter (ADR-0161). */
  const seller = staff('catalog.read', 'orders.place', 'orders.read');

  /** A published variant at this price, with stock in the main warehouse. */
  async function variant(price: number): Promise<string> {
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
            amount: price,
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

  async function promotion(body: object): Promise<string> {
    return (
      await http()
        .post('/v1/admin/promotions')
        .set(signedInAs(administrator))
        .send({ name: 'Buen Fin 10%', percentage: 10, ...body })
        .expect(201)
    ).body.id as string;
  }

  async function guestCart(variantId: string, quantity: number) {
    const cartId = (await http().post('/v1/carts').expect(201)).body
      .id as string;
    await http()
      .post(`/v1/carts/${cartId}/lines`)
      .send({ variantId, quantity })
      .expect(200);
    return cartId;
  }

  const quote = (cartId: string) =>
    http().post('/v1/checkout/quote').send({ cartId }).expect(200);

  const placeGuest = (cartId: string, expectedTotal: number) =>
    http().post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      cartId,
      contactEmail: 'cliente@example.com',
      shippingAddress: ADDRESS,
      privacyNoticeVersion: '2026-09',
      expectedTotal,
    });

  it('quotes and places an online order with the promotion, its discount by line and its email', async () => {
    const shirt = await variant(59_900);
    const id = await promotion({ channels: ['ONLINE'] });
    const cartId = await guestCart(shirt, 2);

    const { body: quoted } = await quote(cartId);
    await placeGuest(cartId, 117_720).expect(201);
    // A guest never sees the ID of the order: the staff reads it.
    const { id: orderId } = await prisma.order.findFirstOrThrow();
    const { body: order } = await http()
      .get(`/v1/admin/orders/${orderId}`)
      .set(signedInAs(administrator))
      .expect(200);
    await app.get(DomainEventDispatcher).whenIdle();

    expect(quoted).toMatchObject({
      lines: [
        {
          variantId: shirt,
          lineTotal: mxn(119_800),
          discountAmount: mxn(11_980),
          // 107,820 × 1600 / 11600 = 14,871.72.
          taxAmount: mxn(14_872),
        },
      ],
      subtotal: mxn(119_800),
      discountTotal: mxn(11_980),
      shippingCost: mxn(9_900),
      taxTotal: mxn(14_872 + 1_366),
      grandTotal: mxn(117_720),
      promotion: { id, name: 'Buen Fin 10%' },
    });
    expect(order).toMatchObject({
      promotion: { id, name: 'Buen Fin 10%' },
      discountTotal: mxn(11_980),
      grandTotal: mxn(117_720),
      lines: [{ discountAmount: mxn(11_980), taxAmount: mxn(14_872) }],
    });
    expect(sent).toEqual([
      expect.objectContaining({
        to: 'cliente@example.com',
        text: expect.stringContaining('Descuento (Buen Fin 10%): -$119.80'),
      }),
    ]);
  });

  it('refuses the total of a quote without the promotion that now applies', async () => {
    const shirt = await variant(59_900);
    const cartId = await guestCart(shirt, 2);
    const { body: before } = await quote(cartId);
    await promotion({});

    const response = await placeGuest(cartId, before.grandTotal.amount).expect(
      409,
    );

    expect(before.promotion).toBeNull();
    expect(response.body).toMatchObject({
      type: expect.stringContaining('total-mismatch'),
      currentTotal: mxn(117_720),
    });
  });

  it('gives an online order no promotion of the store only, nor one of other products', async () => {
    const shirt = await variant(59_900);
    const other = await prisma.productVariant.findUniqueOrThrow({
      where: { id: await variant(10_000) },
    });
    await promotion({ channels: ['STORE'] });
    await promotion({
      percentage: 50,
      targets: [{ type: 'PRODUCT', id: other.productId }],
    });
    const cartId = await guestCart(shirt, 1);

    const { body } = await quote(cartId);

    expect(body).toMatchObject({
      promotion: null,
      discountTotal: mxn(0),
      lines: [{ discountAmount: mxn(0) }],
      grandTotal: mxn(59_900 + 9_900),
    });
  });

  it('loses the free shipping when the discount takes the subtotal under the threshold', async () => {
    const shirt = await variant(79_900);
    const cartId = await guestCart(shirt, 2);
    const { body: without } = await quote(cartId);
    await promotion({});

    const { body: discounted } = await quote(cartId);

    expect(without).toMatchObject({
      subtotal: mxn(159_800),
      shippingCost: mxn(0),
      grandTotal: mxn(159_800),
    });
    // 159,800 less 15,980 is 143,820, under the 150,000 of the threshold.
    expect(discounted).toMatchObject({
      discountTotal: mxn(15_980),
      shippingCost: mxn(9_900),
      grandTotal: mxn(159_800 - 15_980 + 9_900),
    });
  });

  it('charges one peso for a counter sale at 100%', async () => {
    const shirt = await variant(59_900);
    const id = await promotion({
      name: 'Todo gratis',
      percentage: 100,
      channels: ['STORE'],
    });
    const sale = {
      lines: [{ variantId: shirt, quantity: 2 }],
      warehouseId: MAIN,
      fulfillment: 'IN_STORE',
    };

    const { body: quoted } = await http()
      .post('/v1/admin/orders/quote')
      .set(signedInAs(seller))
      .send(sale)
      .expect(200);
    const { body: placed } = await http()
      .post('/v1/admin/orders')
      .set(signedInAs(seller))
      .set('Idempotency-Key', randomUUID())
      .send({ ...sale, expectedTotal: 100 })
      .expect(201);

    expect(quoted).toMatchObject({
      discountTotal: mxn(119_700),
      grandTotal: mxn(100),
      promotion: { id, name: 'Todo gratis' },
    });
    expect(placed).toMatchObject({
      channel: 'STORE',
      promotion: { id, name: 'Todo gratis' },
      subtotal: mxn(119_800),
      discountTotal: mxn(119_700),
      grandTotal: mxn(100),
      // The 100 cents left contain 14 of VAT: 100 × 1600 / 11600 = 13.79.
      taxTotal: mxn(14),
    });
  });
});
