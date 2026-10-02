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
  interiorNumber: 'B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

/** The emails of the life of an order (e2e, T-215, UC-NTF-01, ADR-0074, ADR-0143). */
describe('Order emails (e2e, T-215)', () => {
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
          { action: { startsWith: 'payments.' } },
          { action: { startsWith: 'orders.' } },
          { action: { startsWith: 'shipments.' } },
        ],
      },
    });
    await prisma.paymentAttempt.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
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
  const idle = () => app.get(DomainEventDispatcher).whenIdle();

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const cashier = staff('orders.read', 'payments.manage');
  const manager = staff('orders.read', 'orders.manage');
  const shipper = staff('shipping.manage');

  /** A published variant priced at $100.00, with 10 units. */
  async function variant(title: string): Promise<string> {
    const productId = newId();
    const id = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title,
        slug: `producto-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id,
            sku: `SKU-${id.slice(-12)}`.toUpperCase(),
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

  /** A guest order of these lines, placed with `email`. */
  async function guestOrder(
    lines: { variantId: string; quantity: number }[],
    email = 'cliente@example.com',
  ): Promise<{ id: string; publicCode: string }> {
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
        contactEmail: email,
        shippingAddress: ADDRESS,
        expectedTotal: lines.reduce(
          (sum, { quantity }) => sum + quantity * 10_000,
          9_900,
        ),
        privacyNoticeVersion: '2026-09',
      })
      .expect(201);
    const publicCode = body.publicCode as string;
    const { id } = await prisma.order.findFirstOrThrow({
      where: { publicCode: publicCode.replace('-', '') },
    });
    await idle();
    return { id, publicCode };
  }

  /** The store registers the payment; it answers the payment. */
  async function paid(orderId: string): Promise<string> {
    const { body } = await http()
      .post(`/v1/admin/orders/${orderId}/manual-capture`)
      .set(signedInAs(cashier))
      .send({ reference: 'Ticket 00452' })
      .expect(200);
    await idle();
    return body.payment.id as string;
  }

  const cancel = async (orderId: string, version: number) => {
    await http()
      .post(`/v1/admin/orders/${orderId}/cancel`)
      .set(signedInAs(manager))
      .send({ reason: 'Sin stock', version })
      .expect(200);
    await idle();
  };

  it('tells the buyer the order was received, paid and shipped, with the public code only', async () => {
    const [shirt, cap] = [
      await variant('Camisa de lino'),
      await variant('Gorra'),
    ];
    const { id, publicCode } = await guestOrder(
      [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ],
      'Ana.Perez@Example.com',
    );
    const received = sent.splice(0);

    await paid(id);
    const confirmed = sent.splice(0);
    const { body: shipments } = await http()
      .get(`/v1/admin/shipping/shipments?orderId=${id}`)
      .set(signedInAs(shipper))
      .expect(200);
    const shipmentId = shipments.data[0].id as string;
    await http()
      .patch(`/v1/admin/shipping/shipments/${shipmentId}`)
      .set(signedInAs(shipper))
      .send({ carrierName: 'Estafeta', trackingNumber: 'EST-0001', version: 1 })
      .expect(200);
    await http()
      .post(`/v1/admin/shipping/shipments/${shipmentId}/dispatch`)
      .set(signedInAs(shipper))
      .send({ version: 2 })
      .expect(200);
    await idle();
    const shipped = sent.splice(0);
    await http()
      .post(`/v1/admin/shipping/shipments/${shipmentId}/deliver`)
      .set(signedInAs(shipper))
      .send({ version: 3 })
      .expect(200);
    await idle();

    expect(received).toEqual([
      {
        to: 'ana.perez@example.com',
        subject: `Recibimos tu pedido ${publicCode}`,
        text: expect.any(String),
      },
    ]);
    const text = received[0].text;
    for (const part of [
      '- 2 × Camisa de lino (talla: M): $200.00',
      '- 1 × Gorra (talla: M): $100.00',
      'Subtotal: $300.00',
      'Envío: $99.00',
      'Total: $399.00 (IVA incluido: $55.04)',
      'María López Hernández',
      'Av. Madero Poniente 123, int. B, Centro',
      '58000 Morelia, Michoacán de Ocampo',
      'Apartamos tus productos hasta el',
      `Para pagar, presenta el código ${publicCode} en la tienda y paga $399.00.`,
      'Plazo de entrega estimado: de 3 a 7 días hábiles',
    ]) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain(id);
    expect(text).not.toContain('4431234567');
    expect(confirmed).toEqual([
      {
        to: 'ana.perez@example.com',
        subject: `Pago confirmado de tu pedido ${publicCode}`,
        text: expect.stringContaining(
          `Confirmamos el pago de tu pedido ${publicCode} por $399.00.`,
        ),
      },
    ]);
    expect(shipped).toEqual([
      {
        to: 'ana.perez@example.com',
        subject: `Tu pedido ${publicCode} va en camino`,
        text: expect.stringContaining(
          'Paquetería: Estafeta. Número de guía: EST-0001.',
        ),
      },
    ]);
    expect(sent).toEqual([]);
  });

  it('tells the buyer about a cancellation, with its refund when it was paid, and about the refund', async () => {
    const shirt = await variant('Camisa de lino');
    const unpaid = await guestOrder([{ variantId: shirt, quantity: 1 }]);
    const paidOrder = await guestOrder([{ variantId: shirt, quantity: 1 }]);
    const paymentId = await paid(paidOrder.id);
    sent.length = 0;

    await cancel(unpaid.id, 1);
    await cancel(paidOrder.id, 2);
    const cancelled = sent.splice(0);
    const { body: payment } = await http()
      .get(`/v1/admin/payments/${paymentId}`)
      .set(signedInAs(cashier))
      .expect(200);
    await http()
      .post(`/v1/admin/payments/${paymentId}/refunds/manual`)
      .set(signedInAs(cashier))
      .send({ reference: 'Devolución 00087', version: payment.version })
      .expect(200);
    await idle();

    expect(cancelled).toEqual([
      {
        to: 'cliente@example.com',
        subject: `Tu pedido ${unpaid.publicCode} fue cancelado`,
        text: expect.stringContaining('No se hizo ningún cargo.'),
      },
      {
        to: 'cliente@example.com',
        subject: `Tu pedido ${paidOrder.publicCode} fue cancelado`,
        text: expect.stringContaining(
          'El reembolso de $199.00 está en proceso',
        ),
      },
    ]);
    expect(sent).toEqual([
      {
        to: 'cliente@example.com',
        subject: `Reembolso de tu pedido ${paidOrder.publicCode}`,
        text: expect.stringContaining(
          `Completamos el reembolso de $199.00 de tu pedido ${paidOrder.publicCode}.`,
        ),
      },
    ]);
  });

  it('sends nothing to an anonymized order (BR-NTF-03)', async () => {
    const shirt = await variant('Camisa de lino');
    const { id } = await guestOrder([{ variantId: shirt, quantity: 1 }]);
    sent.length = 0;
    await prisma.order.update({
      where: { id },
      data: { contactEmail: null, anonymizedAt: new Date() },
    });

    await cancel(id, 1);

    expect(sent).toEqual([]);
  });
});
