import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

const INVENTORY = '/v1/admin/inventory';
/** The warehouse the migration creates (ADR-0127). */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

const ADDRESS = {
  recipientName: 'Ana Ruiz',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
};

/** Warehouse, stock and movements over HTTP (T-160 part a, UC-INV-01 to 04, API_SPEC.md §13). */
describe('Inventory (e2e, T-160 part a)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const staffId = newId();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    // In development, so the OpenAPI document is served too (ADR-0096).
    const config = app.get(ConfigService);
    const realGet = config.get.bind(config) as (key: string) => unknown;
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'development' : realGet(key),
      );
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
    await prisma.stockMovement.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.$executeRaw`
      UPDATE warehouses SET name = 'Almacén principal', address = NULL WHERE id = ${MAIN}::uuid`;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'inventory.' } },
          { action: 'warehouses.update' },
          { action: 'http.access-denied' },
        ],
      },
    });
    await app.close();
    jest.restoreAllMocks();
  });

  function staffWith(...permissions: AuthenticatedUser['permissions']) {
    return signedInAs({
      id: staffId,
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });
  }

  const http = () => request(app.getHttpServer());
  const reader = () => staffWith('inventory.read');
  const writer = () => staffWith('inventory.read', 'inventory.write');

  /** Variants of a new product with these SKUs. */
  async function createVariants(
    title: string,
    ...skus: string[]
  ): Promise<string[]> {
    const productId = newId();
    const ids = skus.map(() => newId());
    await prisma.product.create({
      data: { id: productId, title, slug: `p-${productId}`, status: 'DRAFT' },
    });
    await prisma.productVariant.createMany({
      data: skus.map((sku, index) => ({
        id: ids[index],
        productId,
        sku,
        options: { n: String(index) },
        status: 'ACTIVE' as const,
      })),
    });
    return ids;
  }

  const receive = (variantId: string, quantity: number, note?: string) =>
    http()
      .post(`${INVENTORY}/receipts`)
      .set(writer())
      .send({ variantId, warehouseId: MAIN, quantity, note });
  const adjust = (body: Record<string, unknown>) =>
    http()
      .post(`${INVENTORY}/adjustments`)
      .set(writer())
      .send({ warehouseId: MAIN, ...body });

  describe('the warehouse', () => {
    it('lists the one warehouse, and changes its name and address', async () => {
      const list = await http()
        .get(`${INVENTORY}/warehouses`)
        .set(reader())
        .expect(200);
      const changed = await http()
        .patch(`${INVENTORY}/warehouses/${MAIN}`)
        .set(writer())
        .send({ name: 'Almacén Morelia', address: ADDRESS })
        .expect(200);
      const cleared = await http()
        .patch(`${INVENTORY}/warehouses/${MAIN}`)
        .set(writer())
        .send({ address: null })
        .expect(200);

      expect(list.body).toEqual({
        data: [
          {
            id: MAIN,
            code: 'PRINCIPAL',
            name: 'Almacén principal',
            address: null,
            status: 'ACTIVE',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        ],
      });
      expect(changed.body).toMatchObject({
        name: 'Almacén Morelia',
        address: {
          ...ADDRESS,
          interiorNumber: null,
          stateName: 'Michoacán de Ocampo',
          municipalityName: 'Morelia',
          city: null,
          references: null,
          country: 'MX',
        },
      });
      expect(cleared.body).toMatchObject({
        name: 'Almacén Morelia',
        address: null,
      });
    });

    it('answers 400 for a wrong address, 404 for another warehouse and 403 without inventory.write', async () => {
      const wrongPhone = await http()
        .patch(`${INVENTORY}/warehouses/${MAIN}`)
        .set(writer())
        .send({ address: { ...ADDRESS, phone: '443' } })
        .expect(400);
      const wrongMunicipality = await http()
        .patch(`${INVENTORY}/warehouses/${MAIN}`)
        .set(writer())
        .send({ address: { ...ADDRESS, municipalityCode: '16999' } })
        .expect(400);
      const blankName = await http()
        .patch(`${INVENTORY}/warehouses/${MAIN}`)
        .set(writer())
        .send({ name: '   ' })
        .expect(400);
      await http()
        .patch(`${INVENTORY}/warehouses/${newId()}`)
        .set(writer())
        .send({ name: 'Otro' })
        .expect(404);
      await http()
        .patch(`${INVENTORY}/warehouses/${MAIN}`)
        .set(reader())
        .send({ name: 'Otro' })
        .expect(403);

      expect(wrongPhone.body.errors).toEqual([
        expect.objectContaining({ field: 'address.phone', code: 'matches' }),
      ]);
      expect(wrongMunicipality.body.errors).toEqual([
        expect.objectContaining({
          field: 'address.municipalityCode',
          code: 'isMunicipalityOfState',
        }),
      ]);
      expect(blankName.body.errors).toEqual([
        expect.objectContaining({ field: 'name' }),
      ]);
    });
  });

  describe('receipts and adjustments', () => {
    it('receives and adjusts, answering the stock and the movement', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');

      const received = await receive(shirt, 25, 'Remisión 1234').expect(201);
      const adjusted = await adjust({
        variantId: shirt,
        quantity: -2,
        reasonCode: 'DAMAGED',
      }).expect(201);

      expect(received.body).toEqual({
        stockItem: {
          id: expect.any(String),
          variantId: shirt,
          sku: 'CAM-LINO-M',
          productTitle: 'Camisa de lino',
          warehouseId: MAIN,
          onHand: 25,
          reserved: 0,
          available: 25,
          updatedAt: expect.any(String),
        },
        movement: {
          id: expect.any(String),
          stockItemId: received.body.stockItem.id,
          type: 'RECEIPT',
          quantity: 25,
          onHandAfter: 25,
          reasonCode: null,
          note: 'Remisión 1234',
          orderId: null,
          orderLineId: null,
          actorId: staffId,
          createdAt: expect.any(String),
        },
      });
      expect(adjusted.body.stockItem).toMatchObject({
        onHand: 23,
        available: 23,
      });
      expect(adjusted.body.movement).toMatchObject({
        type: 'ADJUSTMENT',
        quantity: -2,
        onHandAfter: 23,
        reasonCode: 'DAMAGED',
      });
    });

    it('answers 409 insufficient-stock with the variant for an adjustment below zero', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      await receive(shirt, 3).expect(201);

      const response = await adjust({
        variantId: shirt,
        quantity: -4,
        reasonCode: 'LOSS_OR_THEFT',
      }).expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/insufficient-stock',
        lines: [{ variantId: shirt, canFulfill: false }],
      });
    });

    it.each([
      [{ quantity: 0, reasonCode: 'PHYSICAL_COUNT' }, 'quantity', 'notEquals'],
      [{ quantity: 100_001, reasonCode: 'PHYSICAL_COUNT' }, 'quantity', 'max'],
      [{ quantity: 2, reasonCode: 'DAMAGED' }, 'quantity', 'reasonDirection'],
      [{ quantity: 2, reasonCode: 'OTHER' }, 'note', 'isNotEmpty'],
      [{ quantity: 2, reasonCode: 'ORDER_CANCELLED' }, 'reasonCode', 'isIn'],
    ])('answers 400 for the adjustment %j', async (body, field, code) => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');

      const response = await adjust({ variantId: shirt, ...body }).expect(400);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ field, code }),
      ]);
    });

    it('answers 404 for a missing variant or warehouse, and 403 without inventory.write', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');

      await receive(newId(), 5).expect(404);
      await http()
        .post(`${INVENTORY}/receipts`)
        .set(writer())
        .send({ variantId: shirt, warehouseId: newId(), quantity: 5 })
        .expect(404);
      await http()
        .post(`${INVENTORY}/receipts`)
        .set(reader())
        .send({ variantId: shirt, warehouseId: MAIN, quantity: 5 })
        .expect(403);
      expect(await prisma.stockItem.count()).toBe(0);
    });
  });

  describe('the listing and the movements', () => {
    it('lists by SKU with filters and the counts of every page', async () => {
      const [shirtM, shirtL] = await createVariants(
        'Camisa de lino',
        'CAM-LINO-M',
        'CAM-LINO-L',
      );
      const [cap] = await createVariants('Gorra', 'GORRA-AZUL');
      await receive(cap, 4).expect(201);
      await receive(shirtM, 10).expect(201);
      await receive(shirtL, 2).expect(201);
      const list = (query: string) =>
        http()
          .get(`${INVENTORY}/stock-items${query}`)
          .set(reader())
          .expect(200);
      const skus = (body: { data: { sku: string }[] }) =>
        body.data.map(({ sku }) => sku);

      const first = await list('?pageSize=2');
      const byText = await list('?q=lino&sort=-sku');
      const low = await list('?availableMax=4&sort=-available');

      expect(skus(first.body)).toEqual(['CAM-LINO-L', 'CAM-LINO-M']);
      expect(first.body.meta).toEqual({
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      });
      expect(skus(byText.body)).toEqual(['CAM-LINO-M', 'CAM-LINO-L']);
      expect(skus(low.body)).toEqual(['GORRA-AZUL', 'CAM-LINO-L']);
      await http()
        .get(`${INVENTORY}/stock-items?sort=price`)
        .set(reader())
        .expect(400);
      await http()
        .get(`${INVENTORY}/stock-items?variantId=talla-m`)
        .set(reader())
        .expect(400);
    });

    it('lists the movements newest first by cursor, and rejects a cursor of another listing', async () => {
      const [shirt] = await createVariants('Camisa de lino', 'CAM-LINO-M');
      const { body } = await receive(shirt, 10).expect(201);
      await adjust({
        variantId: shirt,
        quantity: -2,
        reasonCode: 'DAMAGED',
      }).expect(201);
      await receive(shirt, 5).expect(201);
      const movements = `${INVENTORY}/stock-items/${body.stockItem.id}/movements`;

      const first = await http()
        .get(`${movements}?limit=2`)
        .set(reader())
        .expect(200);
      const second = await http()
        .get(`${movements}?limit=2&cursor=${first.body.meta.nextCursor}`)
        .set(reader())
        .expect(200);
      const adjustments = await http()
        .get(`${movements}?type=ADJUSTMENT`)
        .set(reader())
        .expect(200);
      const today = new Date().toISOString().slice(0, 10);
      const untilToday = await http()
        .get(`${movements}?to=${today}`)
        .set(reader())
        .expect(200);
      const wrongCursor = await http()
        .get(`${movements}?cursor=otro`)
        .set(reader())
        .expect(400);
      const wrongId = await http()
        .get(
          `${movements}?cursor=${Buffer.from(
            JSON.stringify({ createdAt: '2026-10-04T12:00:00.000Z', id: 'x' }),
          ).toString('base64url')}`,
        )
        .set(reader())
        .expect(400);
      await http()
        .get(`${INVENTORY}/stock-items/${newId()}/movements`)
        .set(reader())
        .expect(404);

      expect(
        first.body.data.map(({ quantity }: { quantity: number }) => quantity),
      ).toEqual([5, -2]);
      expect(first.body.meta).toEqual({
        limit: 2,
        nextCursor: expect.any(String),
      });
      expect(second.body).toEqual({
        data: [expect.objectContaining({ quantity: 10, type: 'RECEIPT' })],
        meta: { limit: 2, nextCursor: null },
      });
      expect(adjustments.body.data).toEqual([
        expect.objectContaining({ quantity: -2, reasonCode: 'DAMAGED' }),
      ]);
      // A date alone covers the whole day.
      expect(untilToday.body.data).toHaveLength(3);
      for (const wrong of [wrongCursor, wrongId]) {
        expect(wrong.body.errors).toEqual([
          expect.objectContaining({ field: 'cursor', code: 'cursor' }),
        ]);
      }
    });
  });

  it('documents the endpoints in OpenAPI, and the address fields Identity shares', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const document = response.body as {
      paths: Record<string, Record<string, { tags: string[] }>>;
      components: {
        schemas: Record<string, { properties: Record<string, unknown> }>;
      };
    };

    expect(document.paths[`${INVENTORY}/warehouses`].get.tags).toEqual([
      'Administración: inventario',
    ]);
    for (const path of [
      `${INVENTORY}/stock-items`,
      `${INVENTORY}/stock-items/{stockItemId}/movements`,
    ]) {
      expect(document.paths[path].get).toBeDefined();
    }
    for (const path of ['receipts', 'adjustments']) {
      expect(document.paths[`${INVENTORY}/${path}`].post).toBeDefined();
    }
    expect(
      Object.keys(document.components.schemas.CreateAddressDto.properties),
    ).toEqual(
      expect.arrayContaining([
        'recipientName',
        'municipalityCode',
        'isDefault',
      ]),
    );
    expect(
      Object.keys(document.components.schemas.AddressDto.properties),
    ).toEqual(
      expect.arrayContaining(['id', 'stateName', 'country', 'isDefault']),
    );
  });
});
