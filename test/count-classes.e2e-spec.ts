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

const PRODUCTS = '/v1/admin/catalog/products';
const COUNT_CLASSES = '/v1/admin/catalog/count-classes';
const SUGGESTIONS = '/v1/admin/orders/count-class-suggestions';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const DAY = 86_400_000;

/** The count class of each product and the class its sales suggest, over HTTP (T-166, ADR-0173). */
describe('Count classes (e2e, T-166)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let codes = 0;

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
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'products.' } },
    });
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'http.access-denied' },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const staff = (...permissions: PermissionCode[]) =>
    signedInAs({
      id: newId(),
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    } satisfies AuthenticatedUser);
  const editor = () => staff('catalog.read', 'catalog.write');

  /** A product with one variant, straight in the tables; its ID and its variant's. */
  async function product(
    title: string,
    data: { status?: 'DRAFT' | 'ARCHIVED'; countClass?: 'A' | 'B' | 'C' } = {},
  ): Promise<{ id: string; variantId: string }> {
    const id = newId();
    const variantId = newId();
    await prisma.product.create({
      data: {
        id,
        title,
        slug: `p-${id.slice(-12)}`,
        status: data.status ?? 'DRAFT',
        archivedAt: data.status === 'ARCHIVED' ? new Date() : null,
        countClass: data.countClass,
        variants: {
          create: {
            id: variantId,
            sku: `SKU-${variantId.slice(-12)}`.toUpperCase(),
            options: {},
            status: 'ACTIVE',
          },
        },
      },
    });
    return { id, variantId };
  }

  /** A store order of one line, placed `daysAgo` days ago, in this status. */
  async function sold(
    variantId: string,
    unitPrice: number,
    quantity: number,
    daysAgo: number,
    status:
      'DELIVERED' | 'PAID' | 'CANCELLED' | 'PENDING_PAYMENT' = 'DELIVERED',
  ): Promise<void> {
    codes += 1;
    const total = unitPrice * quantity;
    const at = new Date(Date.now() - daysAgo * DAY);
    await prisma.order.create({
      data: {
        id: newId(),
        publicCode: `CC${String(codes).padStart(6, '0')}`,
        contactEmail: 'cliente@example.com',
        status,
        currency: 'MXN',
        subtotal: total,
        taxTotal: 0,
        shippingCost: 0,
        shippingTaxAmount: 0,
        shippingTaxRateBp: 0,
        grandTotal: total,
        fulfillment: 'IN_STORE',
        channel: 'STORE',
        placedBy: newId(),
        warehouseId: MAIN,
        privacyNoticeVersion: '2026-09',
        placedAt: at,
        paymentDueAt: at,
        lines: {
          create: {
            id: newId(),
            lineNumber: 1,
            variantId,
            sku: 'SKU',
            productName: 'Producto',
            variantOptions: {},
            unitPrice,
            quantity,
            taxRateBp: 0,
            taxAmount: 0,
            lineTotal: total,
          },
        },
      },
    });
  }

  it('creates, edits, shows and filters products by their count class, and audits it', async () => {
    const created = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: 'Zelda', countClass: 'A' })
      .expect(201);
    const plain = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: 'Cable' })
      .expect(201);
    expect(created.body.countClass).toBe('A');
    expect(plain.body.countClass).toBeNull();

    const edited = await http()
      .patch(`${PRODUCTS}/${plain.body.id}`)
      .set(editor())
      .send({ countClass: 'B', version: plain.body.version })
      .expect(200);
    expect(edited.body.countClass).toBe('B');
    await http()
      .patch(`${PRODUCTS}/${plain.body.id}`)
      .set(editor())
      .send({ countClass: 'D', version: edited.body.version })
      .expect(400);
    const titles = async (query: string) =>
      (
        await http()
          .get(`${PRODUCTS}?${query}`)
          .set(staff('catalog.read'))
          .expect(200)
      ).body.data.map(({ title }: { title: string }) => title);
    const third = await product('Funda');

    expect(await titles('countClass=A')).toEqual(['Zelda']);
    expect(await titles('hasCountClass=true&sort=title')).toEqual([
      'Cable',
      'Zelda',
    ]);
    expect(await titles('hasCountClass=false')).toEqual(['Funda']);
    await http()
      .get(`${PRODUCTS}?countClass=X`)
      .set(staff('catalog.read'))
      .expect(400);
    expect(third.id).toBeDefined();
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'products.update', resourceId: plain.body.id },
        select: { changes: true },
      }),
    ).toEqual({ changes: { countClass: { from: null, to: 'B' } } });
  });

  it('sets the class of several products at once, archived too, all or nothing, and audits each change', async () => {
    const zelda = await product('Zelda');
    const cable = await product('Cable', { countClass: 'B' });
    const old = await product('Viejo', { status: 'ARCHIVED', countClass: 'A' });

    const done = await http()
      .put(COUNT_CLASSES)
      .set(editor())
      .send({
        items: [
          { productId: zelda.id, countClass: 'A' },
          { productId: cable.id, countClass: 'B' },
          { productId: old.id, countClass: null },
        ],
      })
      .expect(200);

    expect(done.body).toEqual({ updated: 2 });
    const stored = await prisma.product.findMany({
      select: { title: true, countClass: true, version: true },
      orderBy: { title: 'asc' },
    });
    expect(stored).toEqual([
      { title: 'Cable', countClass: 'B', version: 1 },
      { title: 'Viejo', countClass: null, version: 2 },
      { title: 'Zelda', countClass: 'A', version: 2 },
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'products.update' } }),
    ).toBe(2);

    await http()
      .put(COUNT_CLASSES)
      .set(editor())
      .send({
        items: [
          { productId: cable.id, countClass: 'C' },
          { productId: newId(), countClass: 'A' },
        ],
      })
      .expect(404);
    const twice = await http()
      .put(COUNT_CLASSES)
      .set(editor())
      .send({
        items: [
          { productId: cable.id, countClass: 'C' },
          { productId: cable.id, countClass: 'A' },
        ],
      })
      .expect(400);
    expect(twice.body.errors).toEqual([
      expect.objectContaining({ field: 'items', code: 'duplicateProduct' }),
    ]);
    for (const items of [
      [],
      [{ productId: cable.id, countClass: 'D' }],
      [{ productId: cable.id }],
    ]) {
      await http().put(COUNT_CLASSES).set(editor()).send({ items }).expect(400);
    }
    await http()
      .put(COUNT_CLASSES)
      .set(staff('catalog.read'))
      .send({ items: [{ productId: cable.id, countClass: 'C' }] })
      .expect(403);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: cable.id } }))
        .countClass,
    ).toBe('B');
  });

  it('suggests a class by the sales of the last 90 days, by product, leaving out what was not paid or is older', async () => {
    const zelda = await product('Zelda');
    const zeldaDigital = await prisma.productVariant.create({
      data: {
        id: newId(),
        productId: zelda.id,
        sku: `SKU-${newId().slice(-12)}`.toUpperCase(),
        options: { edicion: 'Digital' },
        status: 'ACTIVE',
      },
    });
    const cable = await product('Cable', { countClass: 'A' });
    const funda = await product('Funda');
    const unsold = await product('Sin ventas');
    await sold(zelda.variantId, 50_000, 1, 3);
    await sold(zeldaDigital.id, 40_000, 1, 89, 'PAID');
    await sold(cable.variantId, 8_000, 1, 10);
    await sold(funda.variantId, 1_000, 2, 1);
    // None of these count.
    await sold(funda.variantId, 900_000, 1, 2, 'CANCELLED');
    await sold(funda.variantId, 900_000, 1, 2, 'PENDING_PAYMENT');
    await sold(cable.variantId, 900_000, 1, 91);

    const found = await http()
      .get(SUGGESTIONS)
      .set(staff('orders.read'))
      .expect(200);

    expect(found.body.data).toEqual([
      {
        productId: zelda.id,
        productTitle: 'Zelda',
        countClass: null,
        sales: { amount: 90_000, currency: 'MXN' },
        units: 2,
        suggestedClass: 'A',
      },
      {
        productId: cable.id,
        productTitle: 'Cable',
        countClass: 'A',
        sales: { amount: 8_000, currency: 'MXN' },
        units: 1,
        suggestedClass: 'B',
      },
      {
        productId: funda.id,
        productTitle: 'Funda',
        countClass: null,
        sales: { amount: 2_000, currency: 'MXN' },
        units: 2,
        suggestedClass: 'C',
      },
    ]);
    expect(found.body.meta).toEqual({
      from: expect.any(String),
      to: expect.any(String),
      days: 90,
      total: { amount: 100_000, currency: 'MXN' },
    });
    expect(
      Date.parse(found.body.meta.to) - Date.parse(found.body.meta.from),
    ).toBe(90 * DAY);
    expect(unsold.id).toBeDefined();
    await http().get(SUGGESTIONS).set(staff('catalog.read')).expect(403);
  });
});
