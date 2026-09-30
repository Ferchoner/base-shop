import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  DuplicateValueError,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  ResourceInUseError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import { ChangeBrandStatus } from '../application/change-brand-status.use-case.js';
import { CreateBrand } from '../application/create-brand.use-case.js';
import { CreateCategory } from '../application/create-category.use-case.js';
import { DeactivateCategory } from '../application/deactivate-category.use-case.js';
import { DeleteBrand } from '../application/delete-brand.use-case.js';
import { DeleteCategory } from '../application/delete-category.use-case.js';
import { ReactivateCategory } from '../application/reactivate-category.use-case.js';
import { UpdateBrand } from '../application/update-brand.use-case.js';
import { UpdateCategory } from '../application/update-category.use-case.js';
import { CatalogModule } from '../catalog.module.js';
import type { BrandId } from '../domain/brand.js';
import {
  CategoryCycleError,
  InactiveParentError,
  UnusableParentError,
} from '../domain/catalog-errors.js';
import type { CategoryId } from '../domain/category.js';

const AUDITED_ACTIONS = [
  'categories.create',
  'categories.update',
  'categories.deactivate',
  'categories.reactivate',
  'categories.delete',
  'brands.create',
  'brands.update',
  'brands.deactivate',
  'brands.reactivate',
  'brands.delete',
];

/** Categories and brands against PostgreSQL 18 (T-150, ADR-0120). */
describe('Categories and brands (T-150)', () => {
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
    await prisma.product.deleteMany();
    // Children before parents: the foreign key restricts deleting a parent.
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

  const createCategory = (
    name: string,
    options: { slug?: string; parentId?: CategoryId; position?: number } = {},
  ) =>
    run(() =>
      moduleRef.get(CreateCategory).execute({
        name,
        slug: options.slug,
        parentId: options.parentId ?? null,
        position: options.position,
      }),
    );

  const updateCategory = (
    id: CategoryId,
    changes: Parameters<UpdateCategory['execute']>[1],
  ) => run(() => moduleRef.get(UpdateCategory).execute(id, changes));

  const deactivateCategory = (id: CategoryId) =>
    run(() => moduleRef.get(DeactivateCategory).execute(id));

  const reactivateCategory = (id: CategoryId) =>
    run(() => moduleRef.get(ReactivateCategory).execute(id));

  const createBrand = (name: string, slug?: string) =>
    run(() => moduleRef.get(CreateBrand).execute({ name, slug }));

  async function insertProduct(
    options: { brandId?: BrandId; categoryIds?: CategoryId[] } = {},
  ): Promise<string> {
    const id = newId();
    await prisma.product.create({
      data: {
        id,
        title: 'Playera',
        slug: `playera-${id}`,
        brandId: options.brandId,
        categories: {
          create: (options.categoryIds ?? []).map((categoryId) => ({
            categoryId,
          })),
        },
      },
    });
    return id;
  }

  const audited = (action: string, resourceId: string) =>
    prisma.auditLog.findMany({
      where: { action, resourceId },
      select: { resourceType: true, changes: true },
    });

  describe('creating categories (UC-CAT-12)', () => {
    it('creates an active root category, with the slug from its name, and audits it', async () => {
      const id = await createCategory('Camisas de Vestir', { position: 2 });

      expect(await queries.findCategory(id)).toMatchObject({
        id,
        parentId: null,
        name: 'Camisas de Vestir',
        slug: 'camisas-de-vestir',
        status: 'ACTIVE',
        position: 2,
        productCount: 0,
        childCount: 0,
      });
      expect(await audited('categories.create', id)).toEqual([
        {
          resourceType: 'category',
          // A root has no parent before or after, so `parentId` is not a change.
          changes: {
            name: { from: null, to: 'Camisas de Vestir' },
            slug: { from: null, to: 'camisas-de-vestir' },
            status: { from: null, to: 'ACTIVE' },
            position: { from: null, to: 2 },
          },
        },
      ]);
    });

    it('numbers a generated slug that is taken: the same name under two parents (ADR-0120)', async () => {
      const men = await createCategory('Hombre');
      const women = await createCategory('Mujer');
      const kids = await createCategory('Niños');

      const first = await createCategory('Camisas', { parentId: men });
      const second = await createCategory('Camisas', { parentId: women });
      const third = await createCategory('Camisas', { parentId: kids });

      expect((await queries.findCategory(first))?.slug).toBe('camisas');
      expect((await queries.findCategory(second))?.slug).toBe('camisas-2');
      expect((await queries.findCategory(third))?.slug).toBe('camisas-3');
    });

    it('rejects a taken slug that the staff gave, without numbering it', async () => {
      await createCategory('Camisas');

      await expect(
        createCategory('Playeras', { slug: 'camisas' }),
      ).rejects.toEqual(new DuplicateValueError('slug'));
    });

    it('rejects a name that a sibling has, whatever its case, also among roots', async () => {
      const parentId = await createCategory('Ropa');
      await createCategory('Camisas', { parentId });

      await expect(
        createCategory('CAMISAS', { parentId, slug: 'camisas-mayus' }),
      ).rejects.toEqual(new DuplicateValueError('name'));
      await expect(createCategory('ropa', { slug: 'ropa-2' })).rejects.toEqual(
        new DuplicateValueError('name'),
      );
    });

    it('rejects an unknown or inactive parent as a validation error of parentId', async () => {
      const inactive = await createCategory('Ropa');
      await deactivateCategory(inactive);

      await expect(
        createCategory('Camisas', { parentId: newId() }),
      ).rejects.toMatchObject({ problem: 'unknown' });
      await expect(
        createCategory('Camisas', { parentId: inactive }),
      ).rejects.toEqual(new UnusableParentError('inactive'));
      expect(await prisma.category.count()).toBe(1);
    });
  });

  describe('updating and moving categories (UC-CAT-12, BR-PRD-03)', () => {
    it('renames, changes the slug and repositions, and audits only what changed', async () => {
      const id = await createCategory('Camisas');

      await updateCategory(id, {
        name: 'Playeras',
        slug: 'playeras',
        position: 5,
      });

      expect(await queries.findCategory(id)).toMatchObject({
        name: 'Playeras',
        slug: 'playeras',
        position: 5,
      });
      expect(await audited('categories.update', id)).toEqual([
        {
          resourceType: 'category',
          changes: {
            name: { from: 'Camisas', to: 'Playeras' },
            slug: { from: 'camisas', to: 'playeras' },
            position: { from: 0, to: 5 },
          },
        },
      ]);
    });

    it('frees the previous slug for another category (ADR-0072)', async () => {
      const id = await createCategory('Camisas');
      await updateCategory(id, { slug: 'camisas-hombre' });

      const other = await createCategory('Camisas', {
        parentId: await createCategory('Mujer'),
      });

      expect((await queries.findCategory(other))?.slug).toBe('camisas');
    });

    it('saves and audits nothing when nothing changes', async () => {
      const parentId = await createCategory('Ropa');
      const id = await createCategory('Camisas', { parentId, position: 1 });

      await updateCategory(id, { name: 'Camisas', parentId, position: 1 });
      await updateCategory(id, {});

      expect(await audited('categories.update', id)).toEqual([]);
    });

    it('moves a category under another one, and to the root', async () => {
      const clothes = await createCategory('Ropa');
      const id = await createCategory('Camisas');

      await updateCategory(id, { parentId: clothes });
      expect(await queries.findCategory(clothes)).toMatchObject({
        childCount: 1,
      });
      expect((await queries.findCategory(id))?.parentId).toBe(clothes);

      await updateCategory(id, { parentId: null });
      expect((await queries.findCategory(id))?.parentId).toBeNull();
      expect(await audited('categories.update', id)).toHaveLength(2);
    });

    it('never moves a category under itself or under one of its subcategories', async () => {
      const clothes = await createCategory('Ropa');
      const shirts = await createCategory('Camisas', { parentId: clothes });
      const sleeves = await createCategory('Manga larga', {
        parentId: shirts,
      });

      await expect(
        updateCategory(clothes, { parentId: clothes }),
      ).rejects.toThrow(CategoryCycleError);
      await expect(
        updateCategory(clothes, { parentId: sleeves }),
      ).rejects.toThrow(CategoryCycleError);
      expect((await queries.findCategory(clothes))?.parentId).toBeNull();
    });

    it('moves only under an existing, active parent', async () => {
      const inactive = await createCategory('Ropa');
      await deactivateCategory(inactive);
      const id = await createCategory('Camisas');

      await expect(updateCategory(id, { parentId: newId() })).rejects.toEqual(
        new UnusableParentError('unknown'),
      );
      await expect(updateCategory(id, { parentId: inactive })).rejects.toEqual(
        new UnusableParentError('inactive'),
      );
    });

    it('lets only one of two opposite moves happen at the same time, so no cycle appears', async () => {
      const a = await createCategory('A');
      const b = await createCategory('B');
      // Hold both rows, so each move gets as far as saving before either one commits. Without the tree
      // lock, both would find no cycle and then both would be saved (BR-PRD-03, ADR-0120).
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query(
        'SELECT id FROM categories WHERE id IN ($1, $2) FOR UPDATE',
        [a, b],
      );

      const results = Promise.allSettled([
        updateCategory(a, { parentId: b }),
        updateCategory(b, { parentId: a }),
      ]);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      await holder.end();
      const [first, second] = await results;

      expect([first.status, second.status].sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = [first, second].find(
        (result) => result.status === 'rejected',
      );
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
        CategoryCycleError,
      );
      const parents = await prisma.category.findMany({
        where: { id: { in: [a, b] } },
        select: { parentId: true },
      });
      expect(parents.filter(({ parentId }) => parentId === null)).toHaveLength(
        1,
      );
    });

    it('rejects a slug that another category has', async () => {
      await createCategory('Camisas');
      const id = await createCategory('Playeras');

      await expect(updateCategory(id, { slug: 'camisas' })).rejects.toEqual(
        new DuplicateValueError('slug'),
      );
    });

    it('answers a missing category as not found', async () => {
      await expect(updateCategory(newId(), { name: 'X' })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('deactivating, reactivating and deleting categories (BR-PRD-10, BR-PRD-13)', () => {
    it('deactivates without touching the subcategories, and reactivates only under an active parent', async () => {
      const clothes = await createCategory('Ropa');
      const shirts = await createCategory('Camisas', { parentId: clothes });
      const sleeves = await createCategory('Manga larga', {
        parentId: shirts,
      });

      await deactivateCategory(shirts);
      await deactivateCategory(clothes);
      expect((await queries.findCategory(sleeves))?.status).toBe('ACTIVE');
      await expect(deactivateCategory(clothes)).rejects.toThrow(
        InvalidStateTransitionError,
      );

      await expect(reactivateCategory(shirts)).rejects.toThrow(
        InactiveParentError,
      );
      await reactivateCategory(clothes);
      await reactivateCategory(shirts);

      expect((await queries.findCategory(shirts))?.status).toBe('ACTIVE');
      await expect(reactivateCategory(shirts)).rejects.toThrow(
        InvalidStateTransitionError,
      );
      expect(await audited('categories.deactivate', clothes)).toEqual([
        {
          resourceType: 'category',
          changes: { status: { from: 'ACTIVE', to: 'INACTIVE' } },
        },
      ]);
      expect(await audited('categories.reactivate', shirts)).toHaveLength(1);
    });

    it('does not reactivate the subcategories of a reactivated category (ADR-0076)', async () => {
      const clothes = await createCategory('Ropa');
      const shirts = await createCategory('Camisas', { parentId: clothes });
      await deactivateCategory(shirts);
      await deactivateCategory(clothes);

      await reactivateCategory(clothes);

      expect((await queries.findCategory(shirts))?.status).toBe('INACTIVE');
    });

    it('deletes an empty category and audits it', async () => {
      const id = await createCategory('Camisas');

      await run(() => moduleRef.get(DeleteCategory).execute(id));

      expect(await queries.findCategory(id)).toBeNull();
      expect(await audited('categories.delete', id)).toHaveLength(1);
    });

    it('does not delete a category with subcategories or products', async () => {
      const clothes = await createCategory('Ropa');
      await createCategory('Camisas', { parentId: clothes });
      const shoes = await createCategory('Zapatos');
      await insertProduct({ categoryIds: [shoes] });
      const remove = (id: CategoryId) =>
        run(() => moduleRef.get(DeleteCategory).execute(id));

      await expect(remove(clothes)).rejects.toThrow(ResourceInUseError);
      await expect(remove(shoes)).rejects.toThrow(ResourceInUseError);

      expect(await queries.findCategory(shoes)).toMatchObject({
        productCount: 1,
      });
      expect(await audited('categories.delete', shoes)).toEqual([]);
    });
  });

  describe('brands (UC-CAT-13)', () => {
    it('creates a brand with the slug from its name, numbered if taken', async () => {
      const first = await createBrand('Café Orgánico');
      await prisma.brand.create({
        data: {
          id: newId(),
          name: 'Otra',
          slug: 'acme',
          status: 'ACTIVE',
        },
      });
      const second = await createBrand('ACME');

      expect(await queries.findBrand(first)).toMatchObject({
        name: 'Café Orgánico',
        slug: 'cafe-organico',
        status: 'ACTIVE',
        productCount: 0,
      });
      expect((await queries.findBrand(second))?.slug).toBe('acme-2');
      expect(await audited('brands.create', first)).toEqual([
        {
          resourceType: 'brand',
          changes: {
            name: { from: null, to: 'Café Orgánico' },
            slug: { from: null, to: 'cafe-organico' },
            status: { from: null, to: 'ACTIVE' },
          },
        },
      ]);
    });

    it('rejects a name another brand has, whatever its case, and a taken slug', async () => {
      await createBrand('Acme');

      await expect(createBrand('ACME', 'acme-mx')).rejects.toEqual(
        new DuplicateValueError('name'),
      );
      await expect(createBrand('Otra', 'acme')).rejects.toEqual(
        new DuplicateValueError('slug'),
      );
    });

    it('renames, deactivates, reactivates and deletes a brand, auditing each change', async () => {
      const id = await createBrand('Acme');
      const status = moduleRef.get(ChangeBrandStatus);

      await run(() =>
        moduleRef.get(UpdateBrand).execute(id, { name: 'Acme MX' }),
      );
      await run(() => moduleRef.get(UpdateBrand).execute(id, { slug: 'acme' }));
      await run(() => status.deactivate(id));
      await expect(run(() => status.deactivate(id))).rejects.toThrow(
        InvalidStateTransitionError,
      );
      await run(() => status.reactivate(id));
      await run(() => moduleRef.get(DeleteBrand).execute(id));

      expect(await queries.findBrand(id)).toBeNull();
      expect(await audited('brands.update', id)).toEqual([
        {
          resourceType: 'brand',
          changes: { name: { from: 'Acme', to: 'Acme MX' } },
        },
      ]);
      for (const action of [
        'brands.deactivate',
        'brands.reactivate',
        'brands.delete',
      ]) {
        expect(await audited(action, id)).toHaveLength(1);
      }
    });

    it('does not delete a brand with products', async () => {
      const id = await createBrand('Acme');
      await insertProduct({ brandId: id });

      await expect(
        run(() => moduleRef.get(DeleteBrand).execute(id)),
      ).rejects.toThrow(ResourceInUseError);
      expect(await queries.findBrand(id)).toMatchObject({ productCount: 1 });
    });

    it('lists brands by page, filtered by part of the name and status, sorted by name', async () => {
      for (const name of ['Delta', 'alfa', 'Charlie', 'Bravo']) {
        await createBrand(name);
      }
      const charlie = await createBrand('Charlie Kids');
      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(charlie));

      const firstPage = await queries.listBrands(
        {},
        [{ field: 'name', direction: 'asc' }],
        { page: 1, pageSize: 3 },
      );
      const descending = await queries.listBrands(
        {},
        [{ field: 'name', direction: 'desc' }],
        { page: 1, pageSize: 10 },
      );
      const filtered = await queries.listBrands(
        { q: 'CHARLIE', statuses: ['ACTIVE'] },
        [{ field: 'name', direction: 'asc' }],
        { page: 1, pageSize: 10 },
      );

      expect(firstPage.totalItems).toBe(5);
      expect(firstPage.items.map(({ name }) => name)).toEqual([
        'alfa',
        'Bravo',
        'Charlie',
      ]);
      expect(descending.items.map(({ name }) => name)[0]).toBe('Delta');
      expect(filtered.items.map(({ name }) => name)).toEqual(['Charlie']);
    });
  });

  it('lists every category with its counts', async () => {
    const clothes = await createCategory('Ropa');
    const shirts = await createCategory('Camisas', { parentId: clothes });
    await createCategory('Pantalones', { parentId: clothes });
    await insertProduct({ categoryIds: [shirts] });
    await insertProduct({ categoryIds: [shirts] });

    const categories = await queries.listCategories();

    expect(categories).toHaveLength(3);
    expect(categories.find(({ id }) => id === clothes)).toMatchObject({
      childCount: 2,
      productCount: 0,
    });
    expect(categories.find(({ id }) => id === shirts)).toMatchObject({
      childCount: 0,
      productCount: 2,
    });
  });
});
