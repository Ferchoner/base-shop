import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { AppCache } from '../src/platform/cache/app-cache.js';
import { DomainEventDispatcher } from '../src/platform/events/domain-event-dispatcher.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const STORE = '/v1/catalog';
const ADMIN = '/v1/admin/catalog';
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';

/** The public store over HTTP (T-140 part c, UC-CAT-01 and 02, API_SPEC.md §11.2, §11.3 and §11.5). */
describe('Storefront (e2e, T-140 part c)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let imageBaseUrl: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    imageBaseUrl = app.get(ConfigService).getOrThrow<string>('IMAGE_BASE_URL');
  });

  afterEach(async () => {
    await app.get(DomainEventDispatcher).whenIdle();
    await app.get(AppCache).namespace('catalog').clear();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productImage.deleteMany();
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
        OR: ['products.', 'categories.', 'brands.', 'prices.', 'stock.'].map(
          (prefix) => ({ action: { startsWith: prefix } }),
        ),
      },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const staff = signedInAs({
    id: newId(),
    type: 'STAFF',
    permissions: [
      'catalog.read',
      'catalog.write',
      'pricing.read',
      'pricing.write',
      'inventory.read',
      'inventory.write',
    ] satisfies AuthenticatedUser['permissions'],
    mustChangePassword: false,
    sessionId: newId(),
  });

  const settled = () => app.get(DomainEventDispatcher).whenIdle();

  async function create(path: string, body: Record<string, unknown>) {
    const response = await http()
      .post(`${ADMIN}/${path}`)
      .set(staff)
      .send(body)
      .expect(201);
    return response.body as { id: string; slug: string; version: number };
  }

  async function addVariant(
    product: { id: string },
    sku: string,
    options: Record<string, string> = {},
  ): Promise<string> {
    const current = await http()
      .get(`${ADMIN}/products/${product.id}`)
      .set(staff)
      .expect(200);
    const response = await http()
      .post(`${ADMIN}/products/${product.id}/variants`)
      .set(staff)
      .send({ sku, options, version: current.body.version })
      .expect(201);
    // The SKU is stored in uppercase (ADR-0123).
    const variants = response.body.variants as { id: string; sku: string }[];
    return variants.find((variant) => variant.sku === sku.toUpperCase())!.id;
  }

  async function lifecycle(product: { id: string }, action: string) {
    const current = await http()
      .get(`${ADMIN}/products/${product.id}`)
      .set(staff)
      .expect(200);
    const response = await http()
      .post(`${ADMIN}/products/${product.id}/${action}`)
      .set(staff)
      .send({ version: current.body.version })
      .expect(200);
    await settled();
    return response.body as { storeVisibility: string };
  }

  const setPrice = (
    variantId: string,
    amount: number,
    compareAtAmount?: number,
  ) =>
    http()
      .post(
        `/v1/admin/pricing/price-lists/${DEFAULT_LIST}/variants/${variantId}/periods`,
      )
      .set(staff)
      .send({ amount, compareAtAmount })
      .expect((response) => {
        expect([200, 201]).toContain(response.status);
      });

  const receive = (variantId: string, quantity: number) =>
    http()
      .post('/v1/admin/inventory/receipts')
      .set(staff)
      .send({ variantId, warehouseId: MAIN, quantity })
      .expect(201);

  /** A published product with one priced variant in stock. */
  async function onSale(
    title: string,
    amount: number,
    extra: Record<string, unknown> = {},
  ) {
    const product = await create('products', { title, ...extra });
    const variantId = await addVariant(product, `SKU-${newId().slice(-12)}`);
    await setPrice(variantId, amount);
    await receive(variantId, 3);
    await lifecycle(product, 'publish');
    return { ...product, variantId };
  }

  describe('GET /v1/catalog/products (UC-CAT-01)', () => {
    it('lists what the store sells as ProductSummary, with the page counts, without signing in', async () => {
      const brand = await create('brands', { name: 'Acme' });
      const shirt = await onSale('Camisa de lino', 59_900, {
        brandId: brand.id,
      });
      await setPrice(shirt.variantId, 49_900, 69_900);
      const key = `products/${shirt.id}/${newId()}.jpg`;
      const image = await prisma.productImage.create({
        data: {
          id: newId(),
          productId: shirt.id,
          storageKey: key,
          contentType: 'image/jpeg',
          sizeBytes: 100,
          altText: 'Vista frontal',
          position: 1,
        },
      });
      await create('products', { title: 'Borrador' });

      const response = await http()
        .get(`${STORE}/products`)
        .query({ pageSize: 1 })
        .expect(200);

      expect(response.body).toEqual({
        data: [
          {
            id: shirt.id,
            slug: 'camisa-de-lino',
            title: 'Camisa de lino',
            brand: { id: brand.id, name: 'Acme', slug: 'acme' },
            fromPrice: { amount: 49_900, currency: 'MXN' },
            compareAtPrice: { amount: 69_900, currency: 'MXN' },
            available: true,
            image: {
              id: image.id,
              url: `${imageBaseUrl}/${key}`,
              altText: 'Vista frontal',
              position: 1,
              variantId: null,
            },
            publishedAt: expect.any(String),
          },
        ],
        meta: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
      });
    });

    it('searches, filters and orders in the database', async () => {
      const [uno, dos] = [
        await create('brands', { name: 'Uno' }),
        await create('brands', { name: 'Dos' }),
      ];
      const shirts = await create('categories', { name: 'Camisas' });
      await onSale('Camisa azul', 30_000, {
        brandId: uno.id,
        categoryIds: [shirts.id],
      });
      await onSale('Camisa roja', 10_000, { brandId: dos.id });
      await onSale('Piñata', 20_000, { brandId: uno.id });

      const titles = async (query: Record<string, unknown>) =>
        (
          (await http().get(`${STORE}/products`).query(query).expect(200))
            .body as { data: { title: string }[] }
        ).data.map(({ title }) => title);

      expect(await titles({ q: 'camisas', sort: '-price' })).toEqual([
        'Camisa azul',
        'Camisa roja',
      ]);
      expect(await titles({ q: 'pinata' })).toEqual(['Piñata']);
      expect(await titles({ category: 'camisas' })).toEqual(['Camisa azul']);
      expect(await titles({ brand: 'dos,uno', sort: 'price' })).toEqual([
        'Camisa roja',
        'Piñata',
        'Camisa azul',
      ]);
      expect(
        await titles({ minPrice: 15_000, maxPrice: 30_000, sort: 'title' }),
      ).toEqual(['Camisa azul', 'Piñata']);
      expect(await titles({ available: 'true', sort: '-title' })).toEqual([
        'Piñata',
        'Camisa roja',
        'Camisa azul',
      ]);
    });

    it.each([
      [{ q: 'a' }, 'q', 'isLength'],
      [{ sort: 'relevance' }, 'sort', 'relevanceNeedsQ'],
      [{ sort: 'price,title' }, 'sort', 'isIn'],
      [{ sort: 'publishedAt' }, 'sort', 'isIn'],
      [{ minPrice: -1 }, 'minPrice', 'min'],
      [{ minPrice: 1.5 }, 'minPrice', 'isInt'],
      [{ minPrice: 500, maxPrice: 499 }, 'maxPrice', 'priceRange'],
      [{ minPrice: 'poco', maxPrice: 499 }, 'minPrice', 'isInt'],
      [{ maxPrice: 'mucho' }, 'maxPrice', 'isInt'],
      [{ available: 'yes' }, 'available', 'isBoolean'],
      [
        { brand: Array.from({ length: 21 }, (_, n) => `m${n}`).join(',') },
        'brand',
        'arrayMaxSize',
      ],
      [{ color: 'azul' }, 'color', 'whitelistValidation'],
      [{ pageSize: 'abc' }, 'pageSize', 'isInt'],
      [{ category: 'no-existe' }, 'category', 'unknownCategory'],
      [{ brand: 'no-existe' }, 'brand', 'unknownBrands'],
    ])('answers 400 validation-error for %j', async (query, field, code) => {
      const response = await http()
        .get(`${STORE}/products`)
        .query(query)
        .expect(400);

      expect(response.body).toMatchObject({
        type: expect.stringContaining('validation-error'),
        errors: [expect.objectContaining({ field, code })],
      });
    });

    it('accepts maxPrice equal to minPrice, and relevance with a search', async () => {
      await http()
        .get(`${STORE}/products`)
        .query({ minPrice: 500, maxPrice: 500 })
        .expect(200);
      await http()
        .get(`${STORE}/products`)
        .query({ q: 'camisa', sort: 'relevance' })
        .expect(200);
    });
  });

  describe('GET /v1/catalog/products/{slug} (UC-CAT-02)', () => {
    it('shows the detail with its sellable variants, available or sold out, never their units', async () => {
      const product = await create('products', {
        title: 'Camisa de lino',
        description: 'Fresca.',
      });
      const small = await addVariant(product, 'CAM-S', { talla: 'S' });
      const medium = await addVariant(product, 'CAM-M', { talla: 'M' });
      await addVariant(product, 'CAM-L', { talla: 'L' });
      await setPrice(small, 59_900, 79_900);
      await setPrice(medium, 59_900);
      await receive(medium, 2);
      await lifecycle(product, 'publish');

      const response = await http()
        .get(`${STORE}/products/camisa-de-lino`)
        .expect(200);

      expect(response.body).toEqual({
        id: product.id,
        slug: 'camisa-de-lino',
        title: 'Camisa de lino',
        brand: null,
        fromPrice: { amount: 59_900, currency: 'MXN' },
        compareAtPrice: { amount: 79_900, currency: 'MXN' },
        available: true,
        image: null,
        publishedAt: expect.any(String),
        description: 'Fresca.',
        categories: [],
        images: [],
        optionNames: ['talla'],
        variants: [
          {
            id: small,
            sku: 'CAM-S',
            options: { talla: 'S' },
            price: { amount: 59_900, currency: 'MXN' },
            compareAtPrice: { amount: 79_900, currency: 'MXN' },
            available: false,
          },
          {
            id: medium,
            sku: 'CAM-M',
            options: { talla: 'M' },
            price: { amount: 59_900, currency: 'MXN' },
            compareAtPrice: null,
            available: true,
          },
        ],
      });
    });

    it('shows its categories by name and its images in order, the first one as the main image', async () => {
      const clothes = await create('categories', { name: 'Ropa' });
      const shirts = await create('categories', { name: 'Camisas' });
      const product = await onSale('Camisa de lino', 59_900, {
        categoryIds: [clothes.id, shirts.id],
      });
      const image = (position: number, variantId: string | null) =>
        prisma.productImage.create({
          data: {
            id: newId(),
            productId: product.id,
            variantId,
            storageKey: `products/${product.id}/${newId()}.jpg`,
            contentType: 'image/jpeg',
            sizeBytes: 100,
            position,
          },
        });
      const back = await image(2, product.variantId);
      const front = await image(1, null);

      const { body } = await http()
        .get(`${STORE}/products/camisa-de-lino`)
        .expect(200);

      expect(body.categories).toEqual([
        { id: shirts.id, name: 'Camisas', slug: 'camisas' },
        { id: clothes.id, name: 'Ropa', slug: 'ropa' },
      ]);
      expect(body.images).toEqual([
        {
          id: front.id,
          url: `${imageBaseUrl}/${front.storageKey}`,
          altText: null,
          position: 1,
          variantId: null,
        },
        {
          id: back.id,
          url: `${imageBaseUrl}/${back.storageKey}`,
          altText: null,
          position: 2,
          variantId: product.variantId,
        },
      ]);
      expect(body.image).toEqual(body.images[0]);
    });

    it('answers 404 for a product the store does not show, and never caches it', async () => {
      const draft = await create('products', { title: 'Borrador' });
      const variant = await addVariant(draft, 'BOR-1');

      for (const slug of ['borrador', 'no-existe', 'No-Es-Slug']) {
        const response = await http()
          .get(`${STORE}/products/${slug}`)
          .expect(404);
        expect(response.body.type).toContain('not-found');
      }
      await lifecycle(draft, 'publish');
      await http().get(`${STORE}/products/borrador`).expect(404);

      // A price raises no event: the detail shows up because the 404 was never kept.
      await setPrice(variant, 1_000);
      await http().get(`${STORE}/products/borrador`).expect(200);
    });
  });

  describe('GET /v1/catalog/brands', () => {
    it('lists the active brands with a product the store shows, in Spanish order', async () => {
      const [nube, nandu] = [
        await create('brands', { name: 'Nube' }),
        await create('brands', { name: 'Ñandú' }),
      ];
      await create('brands', { name: 'Sin productos' });
      await onSale('Uno', 1_000, { brandId: nandu.id });
      await onSale('Dos', 1_000, { brandId: nube.id });

      const response = await http().get(`${STORE}/brands`).expect(200);

      expect(response.body).toEqual({
        data: [
          { id: nube.id, name: 'Nube', slug: 'nube' },
          { id: nandu.id, name: 'Ñandú', slug: 'nandu' },
        ],
      });
    });
  });

  describe('cache (ADR-0028, ADR-0104, ADR-0129)', () => {
    it('keeps listings without search text, the detail and the brands until a product is published or archived', async () => {
      const shirt = await onSale('Camisa', 10_000);
      const listing = () =>
        http().get(`${STORE}/products`).query({ sort: 'price' }).expect(200);
      const priceIn = (response: { body: unknown }) =>
        (response.body as { data: { fromPrice: { amount: number } }[] }).data[0]
          .fromPrice.amount;
      const search = () =>
        http().get(`${STORE}/products`).query({ q: 'camisa' }).expect(200);
      await listing();
      await http().get(`${STORE}/products`).expect(200);
      await search();
      await http().get(`${STORE}/products/camisa`).expect(200);
      await http().get(`${STORE}/brands`).expect(200);

      await setPrice(shirt.variantId, 12_000);
      const brand = await create('brands', { name: 'Nueva' });
      await http()
        .patch(`${ADMIN}/products/${shirt.id}`)
        .set(staff)
        .send({
          brandId: brand.id,
          version: (
            await http().get(`${ADMIN}/products/${shirt.id}`).set(staff)
          ).body.version,
        })
        .expect(200);

      expect(priceIn(await listing())).toBe(10_000);
      // The defaults written out share the entry of the request without them.
      expect(
        priceIn(
          await http()
            .get(`${STORE}/products`)
            .query({ sort: 'price', page: 1 })
            .expect(200),
        ),
      ).toBe(10_000);
      expect(
        priceIn(
          await http()
            .get(`${STORE}/products`)
            .query({ sort: '-publishedAt', available: false })
            .expect(200),
        ),
      ).toBe(10_000);
      expect(
        (await http().get(`${STORE}/products/camisa`).expect(200)).body
          .fromPrice.amount,
      ).toBe(10_000);
      expect((await http().get(`${STORE}/brands`)).body.data).toEqual([]);
      // Searches always go to the database.
      expect(priceIn(await search())).toBe(12_000);

      await onSale('Gorra', 5_000);

      expect(priceIn(await listing())).toBe(5_000);
      expect(
        (await http().get(`${STORE}/products/camisa`).expect(200)).body
          .fromPrice.amount,
      ).toBe(12_000);
      expect((await http().get(`${STORE}/brands`)).body.data).toEqual([
        { id: brand.id, name: 'Nueva', slug: 'nueva' },
      ]);

      await lifecycle(shirt, 'archive');

      await http().get(`${STORE}/products/camisa`).expect(404);
    });
  });

  describe('storeVisibility (UC-CAT-14, ADR-0129)', () => {
    it('tells the staff whether the store shows each product, in the listing and the detail', async () => {
      const visible = await onSale('Visible', 1_000);
      const unpriced = await create('products', { title: 'Sin precio' });
      await addVariant(unpriced, 'SIN-1');
      const published = await lifecycle(unpriced, 'publish');
      await create('products', { title: 'Borrador' });

      const listing = await http()
        .get(`${ADMIN}/products`)
        .query({ sort: 'title' })
        .set(staff)
        .expect(200);
      const detail = await http()
        .get(`${ADMIN}/products/${visible.id}`)
        .set(staff)
        .expect(200);

      expect(published.storeVisibility).toBe('HIDDEN_NO_PRICE');
      expect(
        (listing.body.data as { title: string; storeVisibility: string }[]).map(
          ({ title, storeVisibility }) => [title, storeVisibility],
        ),
      ).toEqual([
        ['Borrador', 'NOT_PUBLISHED'],
        ['Sin precio', 'HIDDEN_NO_PRICE'],
        ['Visible', 'VISIBLE'],
      ]);
      expect(detail.body.storeVisibility).toBe('VISIBLE');
    });
  });
});
