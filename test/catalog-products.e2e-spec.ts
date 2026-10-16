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

const PRODUCTS = '/v1/admin/catalog/products';

/** Products and variants over HTTP (T-140 part a, API_SPEC.md §11.6 and §11.7). */
describe('Products and variants (e2e, T-140 part a)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const editorId = newId();

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
  });

  afterEach(async () => {
    await prisma.productCategory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    for (let depth = 0; depth < 10; depth += 1) {
      await prisma.category.deleteMany({ where: { children: { none: {} } } });
    }
    await prisma.brand.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'products.' } },
          { action: { startsWith: 'categories.' } },
          { action: { startsWith: 'brands.' } },
          { action: 'http.access-denied' },
        ],
      },
    });
    await app.close();
    jest.restoreAllMocks();
  });

  function staffWith(...permissions: AuthenticatedUser['permissions']) {
    return signedInAs({
      id: editorId,
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });
  }

  const http = () => request(app.getHttpServer());
  const editor = () => staffWith('catalog.read', 'catalog.write');

  async function createProduct(body: Record<string, unknown> = {}) {
    const response = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: 'Camisa de lino', ...body })
      .expect(201);
    return response.body as { id: string; slug: string; version: number };
  }

  async function addVariant(
    productId: string,
    version: number,
    body: Record<string, unknown> = {},
  ) {
    const response = await http()
      .post(`${PRODUCTS}/${productId}/variants`)
      .set(editor())
      .send({ sku: 'cam-m', options: { talla: 'M' }, version, ...body })
      .expect(201);
    return response.body as {
      version: number;
      variants: { id: string; sku: string }[];
    };
  }

  it('reads with catalog.read and changes with catalog.write', async () => {
    await http().get(PRODUCTS).set(staffWith('catalog.read')).expect(200);
    await http()
      .post(PRODUCTS)
      .set(staffWith('catalog.read'))
      .send({ title: 'Camisa' })
      .expect(403);
    await http().get(PRODUCTS).set(staffWith('orders.read')).expect(403);
    await http().get(PRODUCTS).expect(401);
  });

  it('creates a draft with its Location, and shows it whole', async () => {
    const brand = await http()
      .post('/v1/admin/catalog/brands')
      .set(editor())
      .send({ name: 'Acme' })
      .expect(201);
    const category = await http()
      .post('/v1/admin/catalog/categories')
      .set(editor())
      .send({ name: 'Camisas' })
      .expect(201);

    const response = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({
        title: 'Camisa de lino',
        description: 'Fresca para el verano.',
        brandId: brand.body.id,
        categoryIds: [category.body.id],
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const second = await createProduct();

    expect(response.headers.location).toBe(`${PRODUCTS}/${response.body.id}`);
    expect(response.body).toEqual({
      id: expect.any(String),
      title: 'Camisa de lino',
      slug: 'camisa-de-lino',
      description: 'Fresca para el verano.',
      brand: { id: brand.body.id, name: 'Acme' },
      categories: [{ id: category.body.id, name: 'Camisas' }],
      status: 'DRAFT',
      storeVisibility: 'NOT_PUBLISHED',
      storeOnly: false,
      variants: [],
      images: [],
      publishedAt: null,
      firstPublishedAt: null,
      archivedAt: null,
      version: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(second.slug).toBe('camisa-de-lino-2');
  });

  it.each([
    [{ title: '  ' }, 'title'],
    [{ title: 't'.repeat(201) }, 'title'],
    [{ slug: 'Camisa' }, 'slug'],
    [{ description: 'd'.repeat(10_001) }, 'description'],
    [{ brandId: 'acme' }, 'brandId'],
    [{ categoryIds: ['ropa'] }, 'categoryIds'],
    [{ categoryIds: Array.from({ length: 11 }, () => newId()) }, 'categoryIds'],
    [{ status: 'PUBLISHED' }, 'status'],
  ])('answers 400 validation-error for %j', async (body, field) => {
    const response = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: 'Camisa', ...body })
      .expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it('answers an unknown brand or category on its field', async () => {
    const brand = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: 'Camisa', brandId: newId() })
      .expect(400);
    const categories = await http()
      .post(PRODUCTS)
      .set(editor())
      .send({ title: 'Camisa', categoryIds: [newId()] })
      .expect(400);

    expect(brand.body.errors).toEqual([
      expect.objectContaining({ field: 'brandId', code: 'unknownBrand' }),
    ]);
    expect(categories.body.errors).toEqual([
      expect.objectContaining({
        field: 'categoryIds',
        code: 'unknownCategories',
      }),
    ]);
  });

  it('adds variants and shows their identity as editable until the first publication', async () => {
    const product = await createProduct();
    const withM = await addVariant(product.id, 1, {
      weightGrams: 350,
      lengthCm: 30.1,
    });

    const response = await http()
      .post(`${PRODUCTS}/${product.id}/variants`)
      .set(editor())
      .send({ sku: 'cam-l', options: { Talla: 'L' }, version: withM.version })
      .expect(201);

    expect(response.body.version).toBe(3);
    expect(response.body.variants).toEqual([
      {
        id: expect.any(String),
        sku: 'CAM-M',
        gtin: null,
        options: { talla: 'M' },
        status: 'ACTIVE',
        weightGrams: 350,
        lengthCm: 30.1,
        widthCm: null,
        heightCm: null,
        editableIdentity: true,
      },
      expect.objectContaining({ sku: 'CAM-L', options: { talla: 'L' } }),
    ]);
  });

  it.each([
    [{ sku: 'CAM M' }, 'sku'],
    [{ options: ['talla'] }, 'options'],
    [{ options: { a: '1', b: '2', c: '3', d: '4' } }, 'options'],
    [{ options: { talla: 42 } }, 'options'],
    [{ weightGrams: 0 }, 'weightGrams'],
    [{ lengthCm: 30.15 }, 'lengthCm'],
    [{ version: undefined }, 'version'],
  ])('answers 400 validation-error for the variant %j', async (body, field) => {
    const product = await createProduct();

    const response = await http()
      .post(`${PRODUCTS}/${product.id}/variants`)
      .set(editor())
      .send({ sku: 'cam-m', options: { talla: 'M' }, version: 1, ...body })
      .expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it('answers the rules of variants: same option names, unique combination and SKU', async () => {
    const product = await createProduct();
    const { version } = await addVariant(product.id, 1);

    const names = await http()
      .post(`${PRODUCTS}/${product.id}/variants`)
      .set(editor())
      .send({ sku: 'cam-azul', options: { color: 'Azul' }, version })
      .expect(400);
    const combination = await http()
      .post(`${PRODUCTS}/${product.id}/variants`)
      .set(editor())
      .send({ sku: 'cam-m2', options: { talla: 'M' }, version })
      .expect(409);
    const sku = await http()
      .post(`${PRODUCTS}/${product.id}/variants`)
      .set(editor())
      .send({ sku: 'CAM-M', options: { talla: 'L' }, version })
      .expect(409);

    expect(names.body.errors).toEqual([
      expect.objectContaining({ field: 'options', code: 'optionNames' }),
    ]);
    expect(combination.body).toMatchObject({
      type: '/problems/duplicate-value',
      field: 'options',
    });
    expect(sku.body).toMatchObject({ field: 'sku' });
  });

  it('publishes only with an active variant, and then locks slug, SKU and options, but not the weight', async () => {
    const product = await createProduct();

    const empty = await http()
      .post(`${PRODUCTS}/${product.id}/publish`)
      .set(editor())
      .send({ version: 1 })
      .expect(409);
    const withVariant = await addVariant(product.id, 1);
    const published = await http()
      .post(`${PRODUCTS}/${product.id}/publish`)
      .set(editor())
      .send({ version: withVariant.version })
      .expect(200);
    const slug = await http()
      .patch(`${PRODUCTS}/${product.id}`)
      .set(editor())
      .send({ slug: 'otra', version: published.body.version })
      .expect(409);
    const sku = await http()
      .patch(`${PRODUCTS}/${product.id}/variants/${withVariant.variants[0].id}`)
      .set(editor())
      .send({ sku: 'OTRO', version: published.body.version })
      .expect(409);
    const weight = await http()
      .patch(`${PRODUCTS}/${product.id}/variants/${withVariant.variants[0].id}`)
      .set(editor())
      .send({ weightGrams: 250, version: published.body.version })
      .expect(200);

    expect(empty.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      reason: 'no-active-variant',
    });
    expect(published.body).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: expect.any(String),
      firstPublishedAt: published.body.publishedAt,
    });
    expect(published.body.variants[0].editableIdentity).toBe(false);
    expect(slug.body).toMatchObject({
      type: '/problems/field-locked',
      fields: ['slug'],
    });
    expect(sku.body).toMatchObject({ fields: ['sku'] });
    expect(weight.body).toMatchObject({
      version: published.body.version + 1,
      variants: [expect.objectContaining({ sku: 'CAM-M', weightGrams: 250 })],
    });
  });

  it('archives and reactivates, and takes no change while archived', async () => {
    const product = await createProduct();

    const archived = await http()
      .post(`${PRODUCTS}/${product.id}/archive`)
      .set(editor())
      .send({ version: 1 })
      .expect(200);
    const edit = await http()
      .patch(`${PRODUCTS}/${product.id}`)
      .set(editor())
      .send({ title: 'Otra', version: archived.body.version })
      .expect(409);
    const reactivated = await http()
      .post(`${PRODUCTS}/${product.id}/reactivate`)
      .set(editor())
      .send({ version: archived.body.version })
      .expect(200);

    expect(archived.body).toMatchObject({
      status: 'ARCHIVED',
      archivedAt: expect.any(String),
    });
    expect(edit.body).toMatchObject({
      type: '/problems/invalid-state-transition',
      currentStatus: 'ARCHIVED',
    });
    expect(reactivated.body).toMatchObject({
      status: 'DRAFT',
      archivedAt: null,
    });
  });

  it('discontinues and reactivates a variant', async () => {
    const product = await createProduct();
    const { version, variants } = await addVariant(product.id, 1);
    const path = `${PRODUCTS}/${product.id}/variants/${variants[0].id}`;

    const discontinued = await http()
      .post(`${path}/discontinue`)
      .set(editor())
      .send({ version })
      .expect(200);
    await http()
      .post(`${path}/discontinue`)
      .set(editor())
      .send({ version: discontinued.body.version })
      .expect(409);
    const reactivated = await http()
      .post(`${path}/reactivate`)
      .set(editor())
      .send({ version: discontinued.body.version })
      .expect(200);

    expect(discontinued.body.variants[0].status).toBe('DISCONTINUED');
    expect(reactivated.body.variants[0].status).toBe('ACTIVE');
  });

  it('answers 409 version-conflict with the current version', async () => {
    const product = await createProduct();
    await http()
      .patch(`${PRODUCTS}/${product.id}`)
      .set(editor())
      .send({ title: 'Uno', version: 1 })
      .expect(200);

    const response = await http()
      .patch(`${PRODUCTS}/${product.id}`)
      .set(editor())
      .send({ title: 'Dos', version: 1 })
      .expect(409);

    expect(response.body).toMatchObject({
      type: '/problems/version-conflict',
      currentVersion: 2,
    });
  });

  it.each(['otro', newId()])(
    'answers 404 not-found for the product %s',
    async (id) => {
      await http().get(`${PRODUCTS}/${id}`).set(editor()).expect(404);
      await http()
        .post(`${PRODUCTS}/${id}/publish`)
        .set(editor())
        .send({ version: 1 })
        .expect(404);
    },
  );

  it('answers 404 not-found for a variant of another product', async () => {
    const product = await createProduct();
    const other = await createProduct({ title: 'Pantalón' });
    const { variants } = await addVariant(other.id, 1);

    await http()
      .post(`${PRODUCTS}/${product.id}/variants/${variants[0].id}/discontinue`)
      .set(editor())
      .send({ version: 1 })
      .expect(404);
  });

  it('lists products by page with filters, without descriptions', async () => {
    await createProduct({ title: 'Blusa', description: 'Larga.' });
    await createProduct({ title: 'Abrigo' });

    const response = await http()
      .get(`${PRODUCTS}?q=blu&status=DRAFT&sort=title&pageSize=5`)
      .set(editor())
      .expect(200);
    await http().get(`${PRODUCTS}?sort=price`).set(editor()).expect(400);
    await http().get(`${PRODUCTS}?status=SOLD`).set(editor()).expect(400);

    expect(response.body.meta).toEqual({
      page: 1,
      pageSize: 5,
      totalItems: 1,
      totalPages: 1,
    });
    expect(response.body.data[0]).toMatchObject({ title: 'Blusa' });
    expect(response.body.data[0]).not.toHaveProperty('description');
  });

  describe('the barcode of the manufacturer (T-142, ADR-0163)', () => {
    const UPC = '036000291452';
    const SAME_AS_EAN = '0036000291452';
    const lookUp = (code: string, by = staffWith('catalog.read')) =>
      http().get('/v1/admin/catalog/variants/lookup').query({ code }).set(by);

    it('takes a GTIN with its check digit, unique among the active variants of every product', async () => {
      const shirt = await createProduct();
      const withGtin = await addVariant(shirt.id, 1, { gtin: UPC });
      const pants = await createProduct({ title: 'Pantalón' });

      const errors = async (gtin: unknown) =>
        (
          await http()
            .post(`${PRODUCTS}/${pants.id}/variants`)
            .set(editor())
            .send({ sku: 'pan-m', options: {}, gtin, version: 1 })
            .expect(400)
        ).body.errors;

      expect(withGtin.variants[0]).toMatchObject({ gtin: UPC });
      expect(await errors('75010313113')).toEqual([
        {
          field: 'gtin',
          code: 'matches',
          message: 'Debe tener 8, 12, 13 o 14 dígitos.',
        },
      ]);
      expect(await errors('7501031311308')).toEqual([
        {
          field: 'gtin',
          code: 'gtinCheckDigit',
          message: 'El dígito verificador no corresponde a este código.',
        },
      ]);
      const taken = await http()
        .post(`${PRODUCTS}/${pants.id}/variants`)
        .set(editor())
        .send({ sku: 'pan-m', options: {}, gtin: SAME_AS_EAN, version: 1 })
        .expect(409);
      expect(taken.body).toMatchObject({
        type: '/problems/duplicate-value',
        field: 'gtin',
      });
    });

    it('changes and removes the GTIN after the first publication, unlike the SKU', async () => {
      const shirt = await createProduct();
      const withVariant = await addVariant(shirt.id, 1);
      const variantPath = `${PRODUCTS}/${shirt.id}/variants/${withVariant.variants[0].id}`;
      const published = await http()
        .post(`${PRODUCTS}/${shirt.id}/publish`)
        .set(editor())
        .send({ version: withVariant.version })
        .expect(200);

      const changed = await http()
        .patch(variantPath)
        .set(editor())
        .send({ gtin: UPC, version: published.body.version })
        .expect(200);
      const removed = await http()
        .patch(variantPath)
        .set(editor())
        .send({ gtin: null, version: changed.body.version })
        .expect(200);

      expect(changed.body.variants[0]).toMatchObject({
        gtin: UPC,
        editableIdentity: false,
      });
      expect(removed.body.variants[0].gtin).toBeNull();
    });

    it('looks a variant up by SKU or GTIN with catalog.read, active first, and lists products by GTIN', async () => {
      const shirt = await createProduct();
      const withGtin = await addVariant(shirt.id, 1, { gtin: UPC });
      await createProduct({ title: 'Pantalón' });

      const byGtin = await lookUp(SAME_AS_EAN).expect(200);
      const bySku = await lookUp('CAM-m').expect(200);
      const none = await lookUp('9999-0').expect(200);
      const listed = await http()
        .get(PRODUCTS)
        .query({ q: '0291452' })
        .set(staffWith('catalog.read'))
        .expect(200);

      expect(byGtin.body).toEqual({
        data: [
          {
            id: withGtin.variants[0].id,
            sku: 'CAM-M',
            gtin: UPC,
            options: { talla: 'M' },
            status: 'ACTIVE',
            matchedBy: 'GTIN',
            product: {
              id: shirt.id,
              title: 'Camisa de lino',
              slug: shirt.slug,
              status: 'DRAFT',
            },
          },
        ],
      });
      expect(bySku.body.data).toEqual([
        expect.objectContaining({ sku: 'CAM-M', matchedBy: 'SKU' }),
      ]);
      expect(none.body).toEqual({ data: [] });
      expect(listed.body.data.map(({ id }: { id: string }) => id)).toEqual([
        shirt.id,
      ]);
    });

    it('asks for a code of SKU characters, and for catalog.read', async () => {
      const blank = await lookUp('CAM M').expect(400);
      await lookUp(UPC, staffWith('orders.read')).expect(403);

      expect(blank.body.errors).toEqual([
        expect.objectContaining({ field: 'code' }),
      ]);
    });
  });

  it('documents the endpoints in OpenAPI', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const paths = (response.body as { paths: Record<string, unknown> }).paths;

    for (const path of [
      PRODUCTS,
      `${PRODUCTS}/{productId}`,
      `${PRODUCTS}/{productId}/publish`,
      `${PRODUCTS}/{productId}/archive`,
      `${PRODUCTS}/{productId}/reactivate`,
      `${PRODUCTS}/{productId}/variants`,
      `${PRODUCTS}/{productId}/variants/{variantId}`,
      `${PRODUCTS}/{productId}/variants/{variantId}/discontinue`,
      `${PRODUCTS}/{productId}/variants/{variantId}/reactivate`,
      '/v1/admin/catalog/variants/lookup',
    ]) {
      expect(paths[path]).toBeDefined();
    }
  });
});
