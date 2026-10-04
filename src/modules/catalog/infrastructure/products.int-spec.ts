import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCache } from '../../../platform/cache/app-cache.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { DomainEventDispatcher } from '../../../platform/events/domain-event-dispatcher.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  DuplicateValueError,
  InvalidStateTransitionError,
  newId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import { ChangeBrandStatus } from '../application/change-brand-status.use-case.js';
import { CreateBrand } from '../application/create-brand.use-case.js';
import { CreateCategory } from '../application/create-category.use-case.js';
import { CreateProduct } from '../application/create-product.use-case.js';
import { DeactivateCategory } from '../application/deactivate-category.use-case.js';
import { ProductLifecycle } from '../application/product-lifecycle.use-case.js';
import { ProductVariants } from '../application/product-variants.use-case.js';
import { PUBLIC_CATALOG_CACHE } from '../application/public-catalog-cache.js';
import { ReactivateCategory } from '../application/reactivate-category.use-case.js';
import { UpdateBrand } from '../application/update-brand.use-case.js';
import { UpdateCategory } from '../application/update-category.use-case.js';
import { UpdateProduct } from '../application/update-product.use-case.js';
import { CatalogModule } from '../catalog.module.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import { Product } from '../domain/product.js';
import {
  FieldLockedError,
  NoActiveVariantError,
  UnusableBrandError,
  UnusableCategoriesError,
} from '../domain/product-errors.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import type { VariantId } from '../domain/variant.js';

const AUDITED_ACTIONS = [
  'products.create',
  'products.update',
  'products.publish',
  'products.archive',
  'products.reactivate',
  'products.variant-create',
  'products.variant-update',
  'products.variant-discontinue',
  'products.variant-reactivate',
  'categories.create',
  'categories.update',
  'categories.deactivate',
  'categories.reactivate',
  'brands.create',
  'brands.update',
  'brands.deactivate',
];

/** Products and variants against PostgreSQL 18 (T-140 part a, ADR-0123). */
describe('Products and variants (T-140 part a)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let queries: CatalogQueries;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        EventsModule,
        AppCacheModule,
        AuditModule,
        CatalogModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    queries = moduleRef.get(CatalogQueries);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.productCategory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    for (let depth = 0; depth < 10; depth += 1) {
      await prisma.category.deleteMany({ where: { children: { none: {} } } });
    }
    await prisma.brand.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { in: AUDITED_ACTIONS } },
    });
  });

  /** Runs a use case in its own async context, as a request does. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  const createProduct = (
    title: string,
    options: {
      slug?: string;
      brandId?: BrandId;
      categoryIds?: CategoryId[];
    } = {},
  ) =>
    run(() =>
      moduleRef.get(CreateProduct).execute({
        title,
        slug: options.slug,
        description: null,
        brandId: options.brandId ?? null,
        categoryIds: options.categoryIds ?? [],
      }),
    );

  const version = async (id: ProductId) =>
    (await prisma.product.findUniqueOrThrow({ where: { id } })).version;

  const updateProduct = async (
    id: ProductId,
    changes: Omit<Parameters<UpdateProduct['execute']>[1], 'version'>,
  ) =>
    run(async () =>
      moduleRef
        .get(UpdateProduct)
        .execute(id, { ...changes, version: await version(id) }),
    );

  const addVariant = async (
    productId: ProductId,
    sku: string,
    options: Record<string, string>,
    sizes: { weightGrams?: number; lengthCm?: number } = {},
  ): Promise<VariantId> =>
    run(async () =>
      moduleRef.get(ProductVariants).add(productId, {
        sku,
        options,
        weightGrams: sizes.weightGrams ?? null,
        lengthCm: sizes.lengthCm ?? null,
        widthCm: null,
        heightCm: null,
        version: await version(productId),
      }),
    );

  const lifecycle = () => moduleRef.get(ProductLifecycle);
  const publish = async (id: ProductId) =>
    run(async () => lifecycle().publish(id, await version(id)));

  const createCategory = (name: string, parentId: CategoryId | null = null) =>
    run(() => moduleRef.get(CreateCategory).execute({ name, parentId }));

  const createBrand = (name: string) =>
    run(() => moduleRef.get(CreateBrand).execute({ name }));

  /** Whether the store's search would find the product with this word, as a prefix (ADR-0060). */
  async function found(id: ProductId, word: string): Promise<boolean> {
    const [row] = await prisma.$queryRaw<{ found: boolean }[]>`
      SELECT coalesce(search_vector @@ to_tsquery('spanish', unaccent(${word}) || ':*'), false) AS found
        FROM products WHERE id = ${id}::uuid`;
    return row.found;
  }

  const audited = (action: string, resourceId: string) =>
    prisma.auditLog.findMany({
      where: { action, resourceId },
      select: { resourceType: true, changes: true },
    });

  describe('creating and editing products (UC-CAT-04 and 05)', () => {
    it('creates a draft with the slug from its title, numbered if taken, and audits it', async () => {
      const first = await createProduct('Camisa de Lino');
      const second = await createProduct('Camisa de lino');

      expect(await queries.findProduct(first)).toMatchObject({
        title: 'Camisa de Lino',
        slug: 'camisa-de-lino',
        description: null,
        status: 'DRAFT',
        brand: null,
        categories: [],
        variants: [],
        images: [],
        version: 1,
      });
      expect((await queries.findProduct(second))?.slug).toBe(
        'camisa-de-lino-2',
      );
      expect(await audited('products.create', first)).toEqual([
        {
          resourceType: 'product',
          changes: {
            title: { from: null, to: 'Camisa de Lino' },
            slug: { from: null, to: 'camisa-de-lino' },
            categoryIds: { from: null, to: [] },
            status: { from: null, to: 'DRAFT' },
          },
        },
      ]);
    });

    it('rejects a taken slug the staff gave', async () => {
      await createProduct('Camisa');

      await expect(createProduct('Otra', { slug: 'camisa' })).rejects.toEqual(
        new DuplicateValueError('slug'),
      );
    });

    it('takes only active brands and categories, but keeps one deactivated later', async () => {
      const brandId = await createBrand('Acme');
      const active = await createCategory('Ropa');
      const inactive = await createCategory('Hogar');
      await run(() => moduleRef.get(DeactivateCategory).execute(inactive));
      const other = await createBrand('Otra');
      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(other));

      await expect(
        createProduct('A', { categoryIds: [newId()] }),
      ).rejects.toEqual(new UnusableCategoriesError('unknown'));
      await expect(
        createProduct('A', { categoryIds: [inactive] }),
      ).rejects.toEqual(new UnusableCategoriesError('inactive'));
      await expect(createProduct('A', { brandId: newId() })).rejects.toEqual(
        new UnusableBrandError('unknown'),
      );
      await expect(createProduct('A', { brandId: other })).rejects.toEqual(
        new UnusableBrandError('inactive'),
      );

      const id = await createProduct('Camisa', {
        brandId,
        categoryIds: [active],
      });
      await run(() => moduleRef.get(DeactivateCategory).execute(active));
      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(brandId));
      await updateProduct(id, {
        title: 'Camisa de lino',
        brandId,
        categoryIds: [active],
      });
      await expect(
        updateProduct(id, { categoryIds: [active, inactive] }),
      ).rejects.toEqual(new UnusableCategoriesError('inactive'));

      expect(await queries.findProduct(id)).toMatchObject({
        title: 'Camisa de lino',
        brand: { id: brandId, name: 'Acme' },
        categories: [{ id: active, name: 'Ropa' }],
      });
    });

    it('answers a category deleted after it was checked as an unknown category, and saves nothing', async () => {
      // Saved straight away, as when the category is deleted between the check of the use case and the save.
      const product = Product.create({
        id: newId(),
        title: 'Camisa',
        slug: 'camisa',
        description: null,
        brandId: null,
        categoryIds: [newId()],
      });

      await expect(
        run(() =>
          moduleRef
            .get(TransactionManager)
            .run(() => moduleRef.get(ProductRepository).save(product)),
        ),
      ).rejects.toEqual(new UnusableCategoriesError('unknown'));
      expect(await queries.findProduct(product.id)).toBeNull();
    });

    it('rejects a change on an older version', async () => {
      const id = await createProduct('Camisa');
      await updateProduct(id, { title: 'Camisa 2' });

      await expect(
        run(() =>
          moduleRef.get(UpdateProduct).execute(id, { title: 'X', version: 1 }),
        ),
      ).rejects.toEqual(new VersionConflictError(2));
    });

    it('lets only one of two edits on the same version win, even when both reach the save together', async () => {
      const id = await createProduct('Camisa');
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [
        id,
      ]);

      const edit = (title: string) =>
        run(() =>
          moduleRef.get(UpdateProduct).execute(id, { title, version: 1 }),
        );
      const results = Promise.allSettled([edit('Uno'), edit('Dos')]);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      await holder.end();
      const settled = await results;

      expect(settled.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await version(id)).toBe(2);
    });

    it('saves and audits nothing when nothing changes', async () => {
      const id = await createProduct('Camisa');

      await updateProduct(id, { title: 'Camisa', description: null });

      expect(await version(id)).toBe(1);
      expect(await audited('products.update', id)).toEqual([]);
    });

    it('counts the same categories in another order as no change', async () => {
      const first = await createCategory('Ropa');
      const second = await createCategory('Verano');
      const id = await createProduct('Camisa', {
        categoryIds: [first, second],
      });

      await updateProduct(id, { categoryIds: [second, first] });

      expect(await version(id)).toBe(1);
      expect(await audited('products.update', id)).toEqual([]);
    });

    it('records only that a long description changed', async () => {
      const id = await createProduct('Camisa');

      await updateProduct(id, { description: 'Fresca para el verano.' });

      expect(await audited('products.update', id)).toEqual([
        {
          resourceType: 'product',
          changes: { description: { changed: true } },
        },
      ]);
    });
  });

  describe('variants (UC-CAT-06 to 08)', () => {
    it('stores variants with their options and sizes, oldest first', async () => {
      const id = await createProduct('Camisa');
      const m = await addVariant(
        id,
        'cam-m',
        { Talla: 'M', color: 'Azul' },
        {
          weightGrams: 350,
          lengthCm: 30.1,
        },
      );
      await addVariant(id, 'cam-l', { talla: 'L', color: 'Azul' });

      const product = await queries.findProduct(id);
      expect(product?.version).toBe(3);
      expect(product?.variants).toEqual([
        {
          id: m,
          sku: 'CAM-M',
          options: { talla: 'M', color: 'Azul' },
          status: 'ACTIVE',
          weightGrams: 350,
          lengthCm: 30.1,
          widthCm: null,
          heightCm: null,
        },
        expect.objectContaining({ sku: 'CAM-L' }),
      ]);
      expect(await audited('products.variant-create', m)).toEqual([
        {
          resourceType: 'variant',
          changes: expect.objectContaining({
            sku: { from: null, to: 'CAM-M' },
            status: { from: null, to: 'ACTIVE' },
          }),
        },
      ]);
    });

    it('rejects a SKU of another product: SKUs are unique everywhere (BR-PRD-01)', async () => {
      const shirt = await createProduct('Camisa');
      const pants = await createProduct('Pantalón');
      await addVariant(shirt, 'ABC-1', {});

      await expect(addVariant(pants, 'abc-1', {})).rejects.toEqual(
        new DuplicateValueError('sku'),
      );
    });

    it('writes only the variant that changed', async () => {
      const id = await createProduct('Camisa');
      const m = await addVariant(id, 'cam-m', { talla: 'M' });
      const l = await addVariant(id, 'cam-l', { talla: 'L' });
      const before = await prisma.productVariant.findUniqueOrThrow({
        where: { id: l },
      });

      await run(async () =>
        moduleRef
          .get(ProductVariants)
          .update(id, m, { weightGrams: 400, version: await version(id) }),
      );

      const after = await prisma.productVariant.findUniqueOrThrow({
        where: { id: l },
      });
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('fixes SKU and options once published', async () => {
      const id = await createProduct('Camisa');
      const m = await addVariant(id, 'cam-m', { talla: 'M' });
      await publish(id);

      await expect(
        run(async () =>
          moduleRef
            .get(ProductVariants)
            .update(id, m, { sku: 'X', version: await version(id) }),
        ),
      ).rejects.toEqual(new FieldLockedError(['sku']));
      await expect(updateProduct(id, { slug: 'otro' })).rejects.toEqual(
        new FieldLockedError(['slug']),
      );
    });

    it('discontinues and reactivates a variant, auditing each on the variant', async () => {
      const id = await createProduct('Camisa');
      const m = await addVariant(id, 'cam-m', { talla: 'M' });
      const variants = moduleRef.get(ProductVariants);

      await run(async () => variants.discontinue(id, m, await version(id)));
      await run(async () => variants.reactivate(id, m, await version(id)));

      expect((await queries.findProduct(id))?.variants[0].status).toBe(
        'ACTIVE',
      );
      expect(await audited('products.variant-discontinue', m)).toEqual([
        {
          resourceType: 'variant',
          changes: { status: { from: 'ACTIVE', to: 'DISCONTINUED' } },
        },
      ]);
      expect(await audited('products.variant-reactivate', m)).toHaveLength(1);
    });
  });

  describe('publishing, archiving and reactivating (UC-CAT-09 and 10)', () => {
    it('publishes only with an active variant, keeping the first publication after a reactivation', async () => {
      const id = await createProduct('Camisa');
      await expect(publish(id)).rejects.toThrow(NoActiveVariantError);
      await addVariant(id, 'cam-m', { talla: 'M' });

      await publish(id);
      const first = await prisma.product.findUniqueOrThrow({ where: { id } });
      await run(async () => lifecycle().archive(id, await version(id)));
      await expect(updateProduct(id, { title: 'X' })).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await run(async () => lifecycle().reactivate(id, await version(id)));
      await publish(id);

      const product = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(first.firstPublishedAt).not.toBeNull();
      expect(product).toMatchObject({
        status: 'PUBLISHED',
        archivedAt: null,
        firstPublishedAt: first.firstPublishedAt,
      });
      expect(await audited('products.publish', id)).toHaveLength(2);
      expect(await audited('products.archive', id)).toEqual([
        {
          resourceType: 'product',
          changes: { status: { from: 'PUBLISHED', to: 'ARCHIVED' } },
        },
      ]);
    });

    it('clears the public catalog cache on publishing, archiving and discontinuing, after the commit', async () => {
      const cache = moduleRef.get(AppCache).namespace(PUBLIC_CATALOG_CACHE);
      const dispatcher = moduleRef.get(DomainEventDispatcher);
      const cached = async () => {
        let loaded = false;
        await cache.getOrLoad('probe', () => {
          loaded = true;
          return Promise.resolve('fresh');
        });
        return !loaded;
      };
      const id = await createProduct('Camisa');
      const m = await addVariant(id, 'cam-m', { talla: 'M' });
      const changes = [
        () => publish(id),
        async () =>
          run(async () =>
            moduleRef
              .get(ProductVariants)
              .discontinue(id, m, await version(id)),
          ),
        async () => run(async () => lifecycle().archive(id, await version(id))),
      ];

      for (const change of changes) {
        await cache.getOrLoad('probe', () => Promise.resolve('cached'));
        await change();
        await dispatcher.whenIdle();
        expect(await cached()).toBe(false);
      }
      // A draft change publishes nothing.
      await cache.getOrLoad('probe', () => Promise.resolve('cached'));
      await run(async () => lifecycle().reactivate(id, await version(id)));
      await dispatcher.whenIdle();
      expect(await cached()).toBe(true);
    });
  });

  describe('search vector (ADR-0060, ADR-0080, ADR-0123)', () => {
    it('finds a product by prefix of its title, brand and categories, without accents', async () => {
      const brandId = await createBrand('Café Orgánico');
      const categoryId = await createCategory('Camisas de Vestir');
      const id = await createProduct('Blusa de algodón', {
        brandId,
        categoryIds: [categoryId],
      });

      expect(await found(id, 'algodon')).toBe(true);
      expect(await found(id, 'blu')).toBe(true);
      expect(await found(id, 'organico')).toBe(true);
      expect(await found(id, 'vestir')).toBe(true);
      expect(await found(id, 'pantalon')).toBe(false);
    });

    it('finds words with ñ or ü written without them, which the Spanish stemmer keeps', async () => {
      const id = await createProduct('Piñata de pingüino');

      expect(await found(id, 'pinata')).toBe(true);
      expect(await found(id, 'pinguino')).toBe(true);
    });

    it('follows edits of the product', async () => {
      const id = await createProduct('Blusa');
      const categoryId = await createCategory('Verano');

      await updateProduct(id, { title: 'Camisola', categoryIds: [categoryId] });

      expect(await found(id, 'camisola')).toBe(true);
      expect(await found(id, 'blusa')).toBe(false);
      expect(await found(id, 'verano')).toBe(true);
    });

    it('drops hidden categories and gets them back when they are visible again (ADR-0080)', async () => {
      const clothes = await createCategory('Ropa');
      const summer = await createCategory('Verano', clothes);
      const beach = await createCategory('Playa');
      const id = await createProduct('Blusa', { categoryIds: [beach] });
      // A move puts it deeper, and hiding an ancestor then hides it.
      await run(() =>
        moduleRef.get(UpdateCategory).execute(beach, { parentId: summer }),
      );

      await run(() => moduleRef.get(DeactivateCategory).execute(clothes));
      expect(await found(id, 'playa')).toBe(false);
      await run(() => moduleRef.get(ReactivateCategory).execute(clothes));
      expect(await found(id, 'playa')).toBe(true);
    });

    it('drops a category that a move hides under a hidden parent', async () => {
      const clothes = await createCategory('Ropa');
      const summer = await createCategory('Verano', clothes);
      await run(() => moduleRef.get(DeactivateCategory).execute(clothes));
      const beach = await createCategory('Playa');
      const id = await createProduct('Blusa', { categoryIds: [beach] });
      expect(await found(id, 'playa')).toBe(true);

      // Verano is active, so the move is allowed, but it is hidden under Ropa (BR-PRD-17).
      await run(() =>
        moduleRef.get(UpdateCategory).execute(beach, { parentId: summer }),
      );

      expect(await found(id, 'playa')).toBe(false);
    });

    it('follows the renames of categories and brands', async () => {
      const categoryId = await createCategory('Verano');
      const brandId = await createBrand('Acme');
      const id = await createProduct('Blusa', {
        brandId,
        categoryIds: [categoryId],
      });

      await run(() =>
        moduleRef
          .get(UpdateCategory)
          .execute(categoryId, { name: 'Primavera' }),
      );
      await run(() =>
        moduleRef.get(UpdateBrand).execute(brandId, { name: 'Zeta' }),
      );

      expect(await found(id, 'primavera')).toBe(true);
      expect(await found(id, 'verano')).toBe(false);
      expect(await found(id, 'zeta')).toBe(true);
      expect(await found(id, 'acme')).toBe(false);
    });

    it('keeps the name of an inactive brand, which products still show (ADR-0080)', async () => {
      const brandId = await createBrand('Acme');
      const id = await createProduct('Blusa', { brandId });

      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(brandId));

      expect(await found(id, 'acme')).toBe(true);
    });
  });

  describe('administrative listing (UC-CAT-14)', () => {
    it('filters by part of the title or a SKU, status, brand and category, and sorts', async () => {
      const brandId = await createBrand('Acme');
      const categoryId = await createCategory('Ropa');
      const shirt = await createProduct('Camisa', {
        brandId,
        categoryIds: [categoryId],
      });
      await addVariant(shirt, 'CAM-LIN-M', {});
      await publish(shirt);
      const pants = await createProduct('Pantalón');
      const archived = await createProduct('Abrigo');
      await run(async () =>
        lifecycle().archive(archived, await version(archived)),
      );

      const list = (filter: Parameters<CatalogQueries['listProducts']>[0]) =>
        queries
          .listProducts(filter, [{ field: 'title', direction: 'asc' }], {
            page: 1,
            pageSize: 10,
          })
          .then(({ items }) => items.map(({ id }) => id));

      expect(await list({})).toEqual([archived, shirt, pants]);
      expect(await list({ q: 'cami' })).toEqual([shirt]);
      expect(await list({ q: 'lin-m' })).toEqual([shirt]);
      expect(await list({ statuses: ['DRAFT', 'ARCHIVED'] })).toEqual([
        archived,
        pants,
      ]);
      expect(await list({ brandId })).toEqual([shirt]);
      expect(await list({ categoryId })).toEqual([shirt]);
      const byPublication = await queries.listProducts(
        {},
        [{ field: 'publishedAt', direction: 'desc' }],
        { page: 1, pageSize: 10 },
      );
      expect(byPublication.items[0].id).toBe(shirt);
      expect(byPublication.items[0]).not.toHaveProperty('description');
    });
  });
});
