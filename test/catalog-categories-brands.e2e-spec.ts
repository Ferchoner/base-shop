import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { AppCache } from '../src/platform/cache/app-cache.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const CATEGORIES = '/v1/admin/catalog/categories';
const BRANDS = '/v1/admin/catalog/brands';

/** Categories and brands over HTTP (T-150, UC-CAT-03, 12 and 13, API_SPEC.md §11.4 and §11.9). */
describe('Categories and brands (e2e, T-150)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cache: AppCache;
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
    cache = app.get(AppCache);
  });

  beforeEach(async () => {
    await cache.namespace('catalog').clear();
  });

  afterEach(async () => {
    await prisma.productCategory.deleteMany();
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

  async function createCategory(
    body: Record<string, unknown>,
  ): Promise<{ id: string; slug: string }> {
    const response = await http()
      .post(CATEGORIES)
      .set(editor())
      .send(body)
      .expect(201);
    return response.body as { id: string; slug: string };
  }

  const createBrand = async (body: Record<string, unknown>) =>
    (await http().post(BRANDS).set(editor()).send(body).expect(201)).body as {
      id: string;
      slug: string;
    };

  describe('authorization', () => {
    it('reads with catalog.read and changes with catalog.write', async () => {
      await http()
        .get(CATEGORIES)
        .set(staffWith('catalog.read'))
        .expect(200)
        .expect('Cache-Control', 'no-store');
      await http().get(BRANDS).set(staffWith('catalog.read')).expect(200);
      await http()
        .post(CATEGORIES)
        .set(staffWith('catalog.read'))
        .send({ name: 'Camisas' })
        .expect(403);
      await http()
        .post(BRANDS)
        .set(staffWith('catalog.read'))
        .send({ name: 'Acme' })
        .expect(403);
      await http().get(CATEGORIES).set(staffWith('orders.read')).expect(403);
      await http().get(BRANDS).expect(401);
      expect(await prisma.category.count()).toBe(0);
    });

    it('is public for the store tree', async () => {
      await http().get('/v1/catalog/categories').expect(200);
    });
  });

  describe('categories (UC-CAT-12)', () => {
    it('creates a category with its Location, generating a numbered slug when the name repeats elsewhere', async () => {
      const men = await createCategory({ name: 'Hombre' });
      const women = await createCategory({ name: 'Mujer' });

      const response = await http()
        .post(CATEGORIES)
        .set(editor())
        .send({ name: 'Camisas', parentId: men.id, position: 2 })
        .expect(201)
        .expect('Cache-Control', 'no-store');
      const second = await createCategory({
        name: 'Camisas',
        parentId: women.id,
      });

      expect(response.headers.location).toBe(
        `${CATEGORIES}/${response.body.id}`,
      );
      expect(response.body).toEqual({
        id: expect.any(String),
        parentId: men.id,
        name: 'Camisas',
        slug: 'camisas',
        status: 'ACTIVE',
        position: 2,
        productCount: 0,
        childCount: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(second.slug).toBe('camisas-2');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'categories.create', resourceId: response.body.id },
      });
      expect(audit).toMatchObject({ actorId: editorId, result: 'SUCCESS' });
    });

    it.each([
      [{ name: '   ' }, 'name'],
      [{ name: 'a'.repeat(101) }, 'name'],
      [{ name: 'Camisas', slug: 'Camisas' }, 'slug'],
      [{ name: 'Camisas', slug: 'camisas--2' }, 'slug'],
      [{ name: 'Camisas', parentId: 'otra' }, 'parentId'],
      [{ name: 'Camisas', position: -1 }, 'position'],
      [{ name: 'Camisas', position: 10001 }, 'position'],
      [{ name: 'Camisas', status: 'INACTIVE' }, 'status'],
    ])('answers 400 validation-error for %j', async (body, field) => {
      const response = await http()
        .post(CATEGORIES)
        .set(editor())
        .send(body)
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/validation-error');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    it('answers an unknown or inactive parent, and a name without slug, as validation errors', async () => {
      const inactive = await createCategory({ name: 'Ropa' });
      await http()
        .post(`${CATEGORIES}/${inactive.id}/deactivate`)
        .set(editor())
        .expect(200);

      const unknown = await http()
        .post(CATEGORIES)
        .set(editor())
        .send({ name: 'Camisas', parentId: newId() })
        .expect(400);
      const inactiveParent = await http()
        .post(CATEGORIES)
        .set(editor())
        .send({ name: 'Camisas', parentId: inactive.id })
        .expect(400);
      const noSlug = await http()
        .post(CATEGORIES)
        .set(editor())
        .send({ name: '¡!' })
        .expect(400);

      expect(unknown.body.errors).toEqual([
        expect.objectContaining({ field: 'parentId', code: 'unknownParent' }),
      ]);
      expect(inactiveParent.body.errors).toEqual([
        expect.objectContaining({ field: 'parentId', code: 'inactiveParent' }),
      ]);
      expect(noSlug.body.errors).toEqual([
        expect.objectContaining({ field: 'slug', code: 'slugRequired' }),
      ]);
    });

    it('answers 409 duplicate-value for a taken slug or a sibling name', async () => {
      await createCategory({ name: 'Camisas' });

      const slug = await http()
        .post(CATEGORIES)
        .set(editor())
        .send({ name: 'Playeras', slug: 'camisas' })
        .expect(409);
      const name = await http()
        .post(CATEGORIES)
        .set(editor())
        .send({ name: 'camisas', slug: 'otra' })
        .expect(409);

      expect(slug.body).toMatchObject({
        type: '/problems/duplicate-value',
        field: 'slug',
      });
      expect(name.body).toMatchObject({ field: 'name' });
    });

    it('edits and moves a category, and never into its own subtree', async () => {
      const clothes = await createCategory({ name: 'Ropa' });
      const shirts = await createCategory({
        name: 'Camisas',
        parentId: clothes.id,
      });

      const edited = await http()
        .patch(`${CATEGORIES}/${shirts.id}`)
        .set(editor())
        .send({ name: 'Playeras', slug: 'playeras', parentId: null })
        .expect(200);
      await http()
        .patch(`${CATEGORIES}/${clothes.id}`)
        .set(editor())
        .send({ parentId: shirts.id })
        .expect(200);
      const cycle = await http()
        .patch(`${CATEGORIES}/${shirts.id}`)
        .set(editor())
        .send({ parentId: clothes.id })
        .expect(409);

      expect(edited.body).toMatchObject({
        name: 'Playeras',
        slug: 'playeras',
        parentId: null,
      });
      expect(cycle.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        reason: 'category-cycle',
      });
    });

    it('deactivates and reactivates a category only when its parent is active', async () => {
      const clothes = await createCategory({ name: 'Ropa' });
      const shirts = await createCategory({
        name: 'Camisas',
        parentId: clothes.id,
      });
      const deactivate = (id: string) =>
        http().post(`${CATEGORIES}/${id}/deactivate`).set(editor());
      const reactivate = (id: string) =>
        http().post(`${CATEGORIES}/${id}/reactivate`).set(editor());

      await deactivate(shirts.id).expect(200);
      const deactivated = await deactivate(clothes.id).expect(200);
      const again = await deactivate(clothes.id).expect(409);
      const underInactive = await reactivate(shirts.id).expect(409);
      await reactivate(clothes.id).expect(200);
      const reactivated = await reactivate(shirts.id).expect(200);

      expect(deactivated.body.status).toBe('INACTIVE');
      expect(again.body).toMatchObject({ currentStatus: 'INACTIVE' });
      expect(underInactive.body).toMatchObject({
        type: '/problems/invalid-state-transition',
        reason: 'inactive-parent',
      });
      expect(reactivated.body.status).toBe('ACTIVE');
    });

    it('deletes an empty category, and not one with subcategories or products', async () => {
      const clothes = await createCategory({ name: 'Ropa' });
      const shirts = await createCategory({
        name: 'Camisas',
        parentId: clothes.id,
      });
      const productId = newId();
      await prisma.product.create({
        data: {
          id: productId,
          title: 'Playera',
          slug: `playera-${productId}`,
          categories: { create: [{ categoryId: shirts.id }] },
        },
      });

      const withChildren = await http()
        .delete(`${CATEGORIES}/${clothes.id}`)
        .set(editor())
        .expect(409);
      await http()
        .delete(`${CATEGORIES}/${shirts.id}`)
        .set(editor())
        .expect(409);
      await prisma.product.delete({ where: { id: productId } });
      await http()
        .delete(`${CATEGORIES}/${shirts.id}`)
        .set(editor())
        .expect(204);

      expect(withChildren.body.type).toBe('/problems/resource-in-use');
      expect(await prisma.category.count()).toBe(1);
    });

    it.each(['otra', newId()])(
      'answers 404 not-found for the category %s',
      async (id) => {
        await http()
          .patch(`${CATEGORIES}/${id}`)
          .set(editor())
          .send({ name: 'X' })
          .expect(404);
        await http()
          .post(`${CATEGORIES}/${id}/deactivate`)
          .set(editor())
          .expect(404);
        await http().delete(`${CATEGORIES}/${id}`).set(editor()).expect(404);
      },
    );

    it('lists the whole tree with counts, and filters by status keeping the ancestors', async () => {
      const clothes = await createCategory({ name: 'Ropa' });
      const shirts = await createCategory({
        name: 'Camisas',
        parentId: clothes.id,
        position: 1,
      });
      await createCategory({ name: 'Pantalones', parentId: clothes.id });
      await http()
        .post(`${CATEGORIES}/${shirts.id}/deactivate`)
        .set(editor())
        .expect(200);

      const all = await http().get(CATEGORIES).set(editor()).expect(200);
      const inactive = await http()
        .get(`${CATEGORIES}?status=INACTIVE`)
        .set(editor())
        .expect(200);
      await http()
        .get(`${CATEGORIES}?status=DELETED`)
        .set(editor())
        .expect(400);

      expect(all.body.data).toHaveLength(1);
      expect(all.body.data[0]).toMatchObject({
        name: 'Ropa',
        childCount: 2,
        children: [
          { name: 'Pantalones', position: 0, children: [] },
          { name: 'Camisas', status: 'INACTIVE', position: 1 },
        ],
      });
      expect(inactive.body.data).toEqual([
        expect.objectContaining({
          name: 'Ropa',
          status: 'ACTIVE',
          children: [
            expect.objectContaining({ name: 'Camisas', status: 'INACTIVE' }),
          ],
        }),
      ]);
    });
  });

  describe('store tree (UC-CAT-03)', () => {
    it('shows only visible categories, with only what the store needs', async () => {
      const clothes = await createCategory({ name: 'Ropa' });
      await createCategory({ name: 'Camisas', parentId: clothes.id });
      const home = await createCategory({ name: 'Hogar', position: 1 });
      await createCategory({ name: 'Cocina', parentId: home.id });
      await http()
        .post(`${CATEGORIES}/${home.id}/deactivate`)
        .set(editor())
        .expect(200);

      const response = await http().get('/v1/catalog/categories').expect(200);

      expect(response.body).toEqual({
        data: [
          {
            id: clothes.id,
            name: 'Ropa',
            slug: 'ropa',
            position: 0,
            children: [
              {
                id: expect.any(String),
                name: 'Camisas',
                slug: 'camisas',
                position: 0,
                children: [],
              },
            ],
          },
        ],
      });
    });

    it('serves the tree from the cache until it expires (ADR-0028, ADR-0076)', async () => {
      const clothes = await createCategory({ name: 'Ropa' });
      await http().get('/v1/catalog/categories').expect(200);

      await http()
        .post(`${CATEGORIES}/${clothes.id}/deactivate`)
        .set(editor())
        .expect(200);
      const cached = await http().get('/v1/catalog/categories').expect(200);
      await cache.namespace('catalog').clear();
      const fresh = await http().get('/v1/catalog/categories').expect(200);

      expect(cached.body.data).toHaveLength(1);
      expect(fresh.body.data).toEqual([]);
    });
  });

  describe('brands (UC-CAT-13)', () => {
    it('creates a brand with its Location and a numbered slug when needed', async () => {
      await createBrand({ name: 'Otra', slug: 'acme' });

      const response = await http()
        .post(BRANDS)
        .set(editor())
        .send({ name: 'ACME' })
        .expect(201);

      expect(response.headers.location).toBe(`${BRANDS}/${response.body.id}`);
      expect(response.body).toEqual({
        id: expect.any(String),
        name: 'ACME',
        slug: 'acme-2',
        status: 'ACTIVE',
        productCount: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('answers 409 for a name another brand has, whatever its case', async () => {
      await createBrand({ name: 'Acme' });

      const response = await http()
        .post(BRANDS)
        .set(editor())
        .send({ name: 'acme', slug: 'acme-mx' })
        .expect(409);

      expect(response.body).toMatchObject({ field: 'name' });
    });

    it('edits, deactivates, reactivates and deletes a brand', async () => {
      const brand = await createBrand({ name: 'Acme' });

      const edited = await http()
        .patch(`${BRANDS}/${brand.id}`)
        .set(editor())
        .send({ name: 'Acme MX', slug: 'acme-mx' })
        .expect(200);
      await http()
        .post(`${BRANDS}/${brand.id}/deactivate`)
        .set(editor())
        .expect(200);
      await http()
        .post(`${BRANDS}/${brand.id}/deactivate`)
        .set(editor())
        .expect(409);
      const reactivated = await http()
        .post(`${BRANDS}/${brand.id}/reactivate`)
        .set(editor())
        .expect(200);
      await http().delete(`${BRANDS}/${brand.id}`).set(editor()).expect(204);

      expect(edited.body).toMatchObject({ name: 'Acme MX', slug: 'acme-mx' });
      expect(reactivated.body.status).toBe('ACTIVE');
      await http()
        .patch(`${BRANDS}/${brand.id}`)
        .set(editor())
        .send({ name: 'X' })
        .expect(404);
    });

    it('does not delete a brand with products', async () => {
      const brand = await createBrand({ name: 'Acme' });
      await prisma.product.create({
        data: {
          id: newId(),
          title: 'Playera',
          slug: 'playera',
          brandId: brand.id,
        },
      });

      const response = await http()
        .delete(`${BRANDS}/${brand.id}`)
        .set(editor())
        .expect(409);

      expect(response.body.type).toBe('/problems/resource-in-use');
    });

    it('lists brands by page, filtered by name and status, sorted by name', async () => {
      for (const name of ['Delta', 'alfa', 'Charlie', 'Bravo']) {
        await createBrand({ name });
      }
      const inactive = await createBrand({ name: 'Charlie Kids' });
      await http()
        .post(`${BRANDS}/${inactive.id}/deactivate`)
        .set(editor())
        .expect(200);

      const page = await http()
        .get(`${BRANDS}?pageSize=2&page=2`)
        .set(editor())
        .expect(200);
      const filtered = await http()
        .get(`${BRANDS}?q=charlie&status=INACTIVE&sort=-name`)
        .set(editor())
        .expect(200);
      await http().get(`${BRANDS}?sort=createdAt`).set(editor()).expect(400);

      expect(page.body.meta).toEqual({
        page: 2,
        pageSize: 2,
        totalItems: 5,
        totalPages: 3,
      });
      expect(page.body.data.map(({ name }: { name: string }) => name)).toEqual([
        'Charlie',
        'Charlie Kids',
      ]);
      expect(
        filtered.body.data.map(({ name }: { name: string }) => name),
      ).toEqual(['Charlie Kids']);
    });
  });

  it('documents the endpoints in OpenAPI', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const document = response.body as {
      paths: Record<string, Record<string, { tags: string[] }>>;
      components: {
        schemas: Record<string, { properties: Record<string, unknown> }>;
      };
    };

    expect(document.paths['/v1/catalog/categories'].get.tags).toEqual([
      'Catálogo',
    ]);
    for (const path of [
      CATEGORIES,
      `${CATEGORIES}/{categoryId}`,
      `${CATEGORIES}/{categoryId}/deactivate`,
      `${CATEGORIES}/{categoryId}/reactivate`,
      BRANDS,
      `${BRANDS}/{brandId}`,
      `${BRANDS}/{brandId}/deactivate`,
      `${BRANDS}/{brandId}/reactivate`,
    ]) {
      expect(document.paths[path]).toBeDefined();
    }
    expect(
      document.components.schemas.PublicCategoryDto.properties.children,
    ).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/PublicCategoryDto' },
      description: 'Subcategorías visibles.',
    });
  });
});
