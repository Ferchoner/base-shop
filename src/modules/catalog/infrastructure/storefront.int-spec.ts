import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  Money,
  newId,
  NotFoundError,
  type Page,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ChangeBrandStatus } from '../application/change-brand-status.use-case.js';
import { CreateBrand } from '../application/create-brand.use-case.js';
import { CreateCategory } from '../application/create-category.use-case.js';
import { CreateProduct } from '../application/create-product.use-case.js';
import { DeactivateCategory } from '../application/deactivate-category.use-case.js';
import { ProductLifecycle } from '../application/product-lifecycle.use-case.js';
import { ProductVariants } from '../application/product-variants.use-case.js';
import { type StoreSearch, Storefront } from '../application/storefront.js';
import {
  type ProductSummaryView,
  StorefrontQueries,
} from '../application/storefront.queries.js';
import { CatalogModule } from '../catalog.module.js';
import type { BrandId } from '../domain/brand.js';
import type { CategoryId } from '../domain/category.js';
import {
  UnknownBrandsFilterError,
  UnknownCategoryFilterError,
} from '../domain/product-errors.js';
import type { ProductId } from '../domain/product-id.js';
import type { VariantId } from '../domain/variant.js';

const PAST = new Date('2026-01-01T00:00:00.000Z');
const START = new Date('2026-10-01T12:00:00.000Z');
const FUTURE = new Date('2026-12-01T00:00:00.000Z');
const PAGE = { page: 1, pageSize: 20 };
const mxn = (amount: number) => Money.of(amount, 'MXN');

/** A clock that moves one second on every read, so each publication has its own time. */
class SteppingClock extends Clock {
  current = START.getTime();

  now(): Date {
    this.current += 1_000;
    return new Date(this.current);
  }
}

/** The public store against PostgreSQL 18, with prices and stock of Pricing and Inventory (T-140 part c). */
describe('Storefront (T-140 part c, ADR-0060)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let storefront: Storefront;
  let defaultListId: string;
  let warehouseId: string;
  const clock = new SteppingClock();

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
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    storefront = moduleRef.get(Storefront);
    // The default list and the warehouse come from their migrations (ADR-0125, ADR-0127).
    defaultListId = (
      await prisma.priceList.findFirstOrThrow({ where: { isDefault: true } })
    ).id;
    warehouseId = (
      await prisma.warehouse.findFirstOrThrow({ where: { status: 'ACTIVE' } })
    ).id;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    clock.current = START.getTime();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.priceList.deleteMany({ where: { isDefault: false } });
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({ where: { id: { not: warehouseId } } });
    await prisma.productImage.deleteMany();
    await prisma.productCategory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    for (let depth = 0; depth < 10; depth += 1) {
      await prisma.category.deleteMany({ where: { children: { none: {} } } });
    }
    await prisma.brand.deleteMany();
    await prisma.auditLog.deleteMany({
      where: {
        OR: ['products.', 'categories.', 'brands.'].map((prefix) => ({
          action: { startsWith: prefix },
        })),
      },
    });
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  const version = async (id: ProductId) =>
    (await prisma.product.findUniqueOrThrow({ where: { id } })).version;

  const createBrand = (name: string) =>
    run(() => moduleRef.get(CreateBrand).execute({ name }));

  const createCategory = (name: string, parentId: CategoryId | null = null) =>
    run(() => moduleRef.get(CreateCategory).execute({ name, parentId }));

  const createProduct = (
    title: string,
    options: {
      brandId?: BrandId;
      categoryIds?: CategoryId[];
      description?: string;
    } = {},
  ) =>
    run(() =>
      moduleRef.get(CreateProduct).execute({
        title,
        description: options.description ?? null,
        brandId: options.brandId ?? null,
        categoryIds: options.categoryIds ?? [],
      }),
    );

  const addVariant = (
    productId: ProductId,
    sku: string,
    options: Record<string, string> = {},
  ): Promise<VariantId> =>
    run(async () =>
      moduleRef.get(ProductVariants).add(productId, {
        sku,
        options,
        weightGrams: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        version: await version(productId),
      }),
    );

  const discontinue = (productId: ProductId, variantId: VariantId) =>
    run(async () =>
      moduleRef
        .get(ProductVariants)
        .discontinue(productId, variantId, await version(productId)),
    );

  const publish = (id: ProductId) =>
    run(async () =>
      moduleRef.get(ProductLifecycle).publish(id, await version(id)),
    );

  const archive = (id: ProductId) =>
    run(async () =>
      moduleRef.get(ProductLifecycle).archive(id, await version(id)),
    );

  /** A price period of the default list; the periods of one variant never overlap (BR-PRC-01). */
  async function price(
    variantId: VariantId,
    amount: number,
    period: { compareAt?: number; from?: Date; to?: Date } = {},
  ): Promise<void> {
    const row = await prisma.variantPrice.upsert({
      where: {
        priceListId_variantId: { priceListId: defaultListId, variantId },
      },
      create: { id: newId(), priceListId: defaultListId, variantId },
      update: {},
    });
    await prisma.pricePeriod.create({
      data: {
        id: newId(),
        variantPriceId: row.id,
        amount,
        compareAtAmount: period.compareAt ?? null,
        effectiveFrom: period.from ?? PAST,
        effectiveTo: period.to ?? null,
        createdBy: newId(),
      },
    });
  }

  const stock = (
    variantId: VariantId,
    onHand: number,
    reserved = 0,
    inWarehouse = warehouseId,
  ) =>
    prisma.stockItem.create({
      data: {
        id: newId(),
        variantId,
        warehouseId: inWarehouse,
        onHand,
        reserved,
      },
    });

  const image = (
    productId: ProductId,
    position: number,
    variantId: VariantId | null = null,
  ) =>
    prisma.productImage.create({
      data: {
        id: newId(),
        productId,
        variantId,
        storageKey: `products/${productId}/${newId()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 100,
        position,
      },
    });

  /** A published product with one variant priced now and in stock, as most tests need. */
  async function onSale(
    title: string,
    amount: number,
    options: { brandId?: BrandId; categoryIds?: CategoryId[] } = {},
  ): Promise<{ id: ProductId; variantId: VariantId }> {
    const id = await createProduct(title, options);
    const variantId = await addVariant(id, `SKU-${newId().slice(-12)}`);
    await price(variantId, amount);
    await stock(variantId, 5);
    await publish(id);
    return { id, variantId };
  }

  const search = (criteria: Partial<StoreSearch>, page = PAGE) =>
    storefront.products({ availableOnly: false, ...criteria }, page);

  const titles = (page: Page<ProductSummaryView>) =>
    page.items.map(({ title }) => title);

  describe('what the store sells (BR-PRD-06 and 11)', () => {
    it('lists only published products with a sellable variant, at the lowest current price of those variants', async () => {
      const shirt = await createProduct('Camisa de lino');
      const [first, discontinued, scheduled, later] = [
        await addVariant(shirt, 'CAM-S', { talla: 'S' }),
        await addVariant(shirt, 'CAM-M', { talla: 'M' }),
        await addVariant(shirt, 'CAM-L', { talla: 'L' }),
        await addVariant(shirt, 'CAM-XL', { talla: 'XL' }),
      ];
      await price(first, 59_900, { compareAt: 79_900 });
      await price(discontinued, 39_900);
      await price(scheduled, 49_900, { from: FUTURE });
      await price(later, 59_900);
      await publish(shirt);
      await discontinue(shirt, discontinued);

      const draft = await createProduct('Borrador');
      await price(await addVariant(draft, 'BOR-1'), 100);
      const unpriced = await createProduct('Sin precio');
      await addVariant(unpriced, 'SIN-1');
      await publish(unpriced);
      const expired = await createProduct('Precio vencido');
      await price(await addVariant(expired, 'VEN-1'), 100, {
        to: new Date('2026-06-01T00:00:00.000Z'),
      });
      await publish(expired);
      const archived = await onSale('Archivado', 100);
      await archive(archived.id);

      const page = await search({});

      expect(page).toEqual({
        items: [
          {
            id: shirt,
            slug: 'camisa-de-lino',
            title: 'Camisa de lino',
            brand: null,
            // CAM-S and CAM-XL tie; the oldest variant gives its compare-at price.
            fromPrice: mxn(59_900),
            compareAtPrice: mxn(79_900),
            available: false,
            image: null,
            publishedAt: expect.any(Date) as Date,
          },
        ],
        totalItems: 1,
      });
    });

    it('reads only the default list (BR-PRC-06)', async () => {
      const other = await prisma.priceList.create({
        data: {
          id: newId(),
          code: 'OTRA',
          name: 'Otra lista',
          currency: 'MXN',
          priority: 99,
          isDefault: false,
          status: 'INACTIVE',
        },
      });
      const id = await createProduct('Otra lista');
      const variantId = await addVariant(id, 'OTR-1');
      const row = await prisma.variantPrice.create({
        data: { id: newId(), priceListId: other.id, variantId },
      });
      await prisma.pricePeriod.create({
        data: {
          id: newId(),
          variantPriceId: row.id,
          amount: 1_000,
          effectiveFrom: PAST,
          createdBy: newId(),
        },
      });
      await publish(id);

      expect(await search({})).toEqual({ items: [], totalItems: 0 });
      expect(await storefront.visibilities([id])).toEqual(['HIDDEN_NO_PRICE']);
    });

    it('shows a scheduled price, and with it the product, once it starts, without any job (ADR-0060)', async () => {
      const id = await createProduct('Lámpara');
      await price(await addVariant(id, 'LAM-1'), 25_000, {
        from: new Date(START.getTime() + 60 * 60 * 1_000),
      });
      await publish(id);

      expect((await search({})).totalItems).toBe(0);
      clock.current += 2 * 60 * 60 * 1_000;
      expect(titles(await search({}))).toEqual(['Lámpara']);
    });

    it('tells available from sold out by the units not reserved in an active warehouse (ADR-0061)', async () => {
      const soldOut = await createProduct('Agotado');
      const reserved = await addVariant(soldOut, 'AGO-1', { talla: 'S' });
      const noStock = await addVariant(soldOut, 'AGO-2', { talla: 'M' });
      const elsewhere = await addVariant(soldOut, 'AGO-3', { talla: 'L' });
      for (const variant of [reserved, noStock, elsewhere]) {
        await price(variant, 1_000);
      }
      await stock(reserved, 2, 2);
      const inactive = await prisma.warehouse.create({
        data: {
          id: newId(),
          code: 'OTRO',
          name: 'Otro almacén',
          status: 'INACTIVE',
        },
      });
      await stock(elsewhere, 9, 0, inactive.id);
      await publish(soldOut);
      // One variant available is enough for the product (ADR-0061).
      const inStock = await createProduct('Disponible');
      const last = await addVariant(inStock, 'DIS-1', { talla: 'S' });
      const gone = await addVariant(inStock, 'DIS-2', { talla: 'M' });
      await price(last, 1_000);
      await price(gone, 1_000);
      await stock(last, 3, 2);
      await stock(gone, 1, 1);
      await publish(inStock);

      const all = await search({ sort: 'title' });
      const onlyAvailable = await search({ availableOnly: true });

      expect(
        all.items.map(({ title, available }) => [title, available]),
      ).toEqual([
        ['Agotado', false],
        ['Disponible', true],
      ]);
      expect(onlyAvailable).toMatchObject({
        items: [{ title: 'Disponible' }],
        totalItems: 1,
      });
    });

    it('adds up the active warehouses: a variant is available in any of them, and each product and variant comes once (ADR-0160)', async () => {
      const north = await prisma.warehouse.create({
        data: {
          id: newId(),
          code: 'NORTE',
          name: 'Almacén norte',
          status: 'ACTIVE',
          priority: 2,
        },
      });
      const shirt = await createProduct('Camisa');
      const [taken, both] = [
        await addVariant(shirt, 'CAM-1', { talla: 'S' }),
        await addVariant(shirt, 'CAM-2', { talla: 'M' }),
      ];
      await price(taken, 1_000);
      await price(both, 2_000);
      // Every unit of the main warehouse is reserved; the north one has the shirts the store sells.
      await stock(taken, 1, 1);
      await stock(taken, 2, 0, north.id);
      await stock(both, 1, 0);
      await stock(both, 1, 0, north.id);
      await publish(shirt);
      const elsewhere = await createProduct('Gorra');
      const cap = await addVariant(elsewhere, 'GOR-1');
      await price(cap, 1_000);
      await stock(cap, 1, 1);
      await stock(cap, 3, 3, north.id);
      await publish(elsewhere);

      const all = await search({ sort: 'title' });
      const detail = await storefront.product('camisa');

      expect(
        all.items.map(({ title, available, fromPrice }) => [
          title,
          available,
          fromPrice.amount,
        ]),
      ).toEqual([
        ['Camisa', true, 1_000],
        ['Gorra', false, 1_000],
      ]);
      expect(all.totalItems).toBe(2);
      expect(await search({ availableOnly: true })).toMatchObject({
        items: [{ title: 'Camisa' }],
        totalItems: 1,
      });
      expect(
        detail.variants.map(({ sku, available }) => [sku, available]),
      ).toEqual([
        ['CAM-1', true],
        ['CAM-2', true],
      ]);
    });
  });

  describe('search (ADR-0060, ADR-0123)', () => {
    it('finds by the start of words, without accents, in the title, the brand and the visible categories', async () => {
      const party = await createBrand('Fiesta Feliz');
      const summer = await createCategory('Ropa de Verano');
      const hidden = await createCategory('Oculta');
      await onSale('Piñata de cumpleaños', 30_000, { brandId: party });
      await onSale('Camisa de lino', 59_900, { categoryIds: [summer] });
      await onSale('Camiseta básica', 19_900, { categoryIds: [hidden] });
      await run(() => moduleRef.get(DeactivateCategory).execute(hidden));

      const found = async (q: string) =>
        titles(await search({ q, sort: 'title' }));

      expect(await found('pinata')).toEqual(['Piñata de cumpleaños']);
      expect(await found('PIÑAT')).toEqual(['Piñata de cumpleaños']);
      expect(await found('cami')).toEqual([
        'Camisa de lino',
        'Camiseta básica',
      ]);
      expect(await found('camisas lino')).toEqual(['Camisa de lino']);
      expect(await found('fiest')).toEqual(['Piñata de cumpleaños']);
      expect(await found('verano')).toEqual(['Camisa de lino']);
      expect(await found('oculta')).toEqual([]);
      expect(await found('basica')).toEqual(['Camiseta básica']);
    });

    it('orders by relevance: a match in the title before one in a category', async () => {
      const linen = await createCategory('Lino natural');
      // Published first, so only relevance can put it first.
      await onSale('Pantalón de lino', 20_000);
      await onSale('Camisa básica', 10_000, { categoryIds: [linen] });

      expect(titles(await search({ q: 'lino' }))).toEqual([
        'Pantalón de lino',
        'Camisa básica',
      ]);
    });

    it('finds nothing for a text without letters or digits, nor for stop words alone', async () => {
      await onSale('Camisa de lino', 59_900);

      expect(await search({ q: '¡!' })).toEqual({ items: [], totalItems: 0 });
      expect(await search({ q: 'de' })).toEqual({ items: [], totalItems: 0 });
      expect(titles(await search({ q: 'camisa, de: lino' }))).toEqual([
        'Camisa de lino',
      ]);
    });
  });

  describe('filters (ADR-0060, ADR-0080)', () => {
    it('filters by a visible category with its visible subcategories', async () => {
      const clothes = await createCategory('Ropa');
      const shirts = await createCategory('Camisas', clothes);
      const hiddenChild = await createCategory('Sombreros', clothes);
      const toys = await createCategory('Juguetes');
      await onSale('Pantalón', 1_000, { categoryIds: [clothes] });
      await onSale('Camisa', 1_000, { categoryIds: [shirts] });
      await onSale('Sombrero', 1_000, { categoryIds: [hiddenChild] });
      await onSale('Pelota', 1_000, { categoryIds: [toys] });
      await run(() => moduleRef.get(DeactivateCategory).execute(hiddenChild));

      expect(titles(await search({ category: 'ropa', sort: 'title' }))).toEqual(
        ['Camisa', 'Pantalón'],
      );
      expect(titles(await search({ category: 'camisas' }))).toEqual(['Camisa']);
    });

    it('rejects a category that does not exist or is hidden, the same way (ADR-0129)', async () => {
      const parent = await createCategory('Ropa');
      await createCategory('Camisas', parent);
      await run(() => moduleRef.get(DeactivateCategory).execute(parent));
      const toys = await createCategory('Juguetes');
      const inactiveChild = await createCategory('Pelotas', toys);
      await run(() => moduleRef.get(DeactivateCategory).execute(inactiveChild));

      expect(titles(await search({ category: 'juguetes' }))).toEqual([]);
      for (const category of ['no-existe', 'ropa', 'camisas', 'pelotas']) {
        await expect(search({ category })).rejects.toThrow(
          UnknownCategoryFilterError,
        );
      }
    });

    it('filters by one or more active brands, and rejects an unknown or inactive one', async () => {
      const [one, two, three] = [
        await createBrand('Marca Uno'),
        await createBrand('Marca Dos'),
        await createBrand('Marca Tres'),
      ];
      await onSale('Producto uno', 1_000, { brandId: one });
      await onSale('Producto dos', 1_000, { brandId: two });
      await onSale('Producto tres', 1_000, { brandId: three });
      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(three));

      expect(
        titles(
          await search({
            brands: ['marca-uno', 'marca-dos', 'marca-uno'],
            sort: 'title',
          }),
        ),
      ).toEqual(['Producto dos', 'Producto uno']);
      await expect(
        search({ brands: ['marca-uno', 'marca-tres'] }),
      ).rejects.toThrow(UnknownBrandsFilterError);
      await expect(search({ brands: ['no-existe'] })).rejects.toThrow(
        UnknownBrandsFilterError,
      );
    });

    it('filters by the price of the product, its lowest sellable price, with both ends included', async () => {
      const both = await createProduct('Dos precios');
      await price(await addVariant(both, 'DOS-1', { talla: 'S' }), 5_000);
      await price(await addVariant(both, 'DOS-2', { talla: 'M' }), 20_000);
      await publish(both);
      await onSale('Diez mil', 10_000);
      await onSale('Quince mil', 15_000);

      expect(
        titles(
          await search({ minPrice: 10_000, maxPrice: 15_000, sort: 'price' }),
        ),
      ).toEqual(['Diez mil', 'Quince mil']);
      expect(titles(await search({ maxPrice: 5_000 }))).toEqual([
        'Dos precios',
      ]);
      expect(titles(await search({ minPrice: 15_001 }))).toEqual([]);
    });

    it('counts every match, not only the page, so totals are exact', async () => {
      for (const title of ['A', 'B', 'C', 'D', 'E']) {
        await onSale(title, 1_000);
      }
      await createProduct('Sin publicar');

      const second = await search({ sort: 'title' }, { page: 2, pageSize: 2 });
      const beyond = await search({ sort: 'title' }, { page: 4, pageSize: 2 });

      expect(second).toMatchObject({ totalItems: 5 });
      expect(titles(second)).toEqual(['C', 'D']);
      expect(beyond).toEqual({ items: [], totalItems: 5 });
    });
  });

  describe('orders (API_SPEC.md §11.2)', () => {
    it('orders by the newest publication by default, by price, and by title in Spanish', async () => {
      await onSale('Oso', 3_000);
      await onSale('árbol', 5_000);
      await onSale('Ñandú', 1_000);
      await onSale('Nube', 4_000);
      await onSale('Arco', 2_000);

      expect(titles(await search({}))).toEqual([
        'Arco',
        'Nube',
        'Ñandú',
        'árbol',
        'Oso',
      ]);
      expect(titles(await search({ sort: 'price' }))).toEqual([
        'Ñandú',
        'Arco',
        'Oso',
        'Nube',
        'árbol',
      ]);
      expect(titles(await search({ sort: '-price' }))).toEqual([
        'árbol',
        'Nube',
        'Oso',
        'Arco',
        'Ñandú',
      ]);
      expect(titles(await search({ sort: 'title' }))).toEqual([
        'árbol',
        'Arco',
        'Nube',
        'Ñandú',
        'Oso',
      ]);
      expect(titles(await search({ sort: '-title' }))).toEqual([
        'Oso',
        'Ñandú',
        'Nube',
        'Arco',
        'árbol',
      ]);
    });

    it('orders by relevance without words as without a search: newest first', async () => {
      await onSale('Primero', 1_000);
      await onSale('Segundo', 1_000);

      const page = await moduleRef
        .get(StorefrontQueries)
        .listProducts(
          { availableOnly: false, sort: 'relevance' },
          PAGE,
          new Date(clock.current + 1_000),
        );

      expect(titles(page)).toEqual(['Segundo', 'Primero']);
    });

    it('breaks ties by ID', async () => {
      const ids = [
        (await onSale('Igual', 1_000)).id,
        (await onSale('Igual', 1_000)).id,
        (await onSale('Igual', 1_000)).id,
      ].sort();

      for (const sort of ['price', 'title', '-title'] as const) {
        expect((await search({ sort })).items.map(({ id }) => id)).toEqual(ids);
      }
    });
  });

  describe('images (ADR-0129)', () => {
    it('shows the first image the store can show, never one of a variant it does not sell', async () => {
      const shirt = await createProduct('Camisa');
      const blue = await addVariant(shirt, 'CAM-AZ', { color: 'Azul' });
      const red = await addVariant(shirt, 'CAM-RO', { color: 'Rojo' });
      await price(blue, 1_000);
      await publish(shirt);
      await image(shirt, 1, red);
      const second = await image(shirt, 2, blue);
      const third = await image(shirt, 3);
      await onSale('Sin fotos', 1_000);

      const page = await search({ sort: 'title' });
      const detail = await storefront.product('camisa');

      expect(page.items.map((item) => item.image?.id ?? null)).toEqual([
        second.id,
        null,
      ]);
      expect(page.items[0].image).toEqual({
        id: second.id,
        storageKey: second.storageKey,
        altText: null,
        position: 2,
        variantId: blue,
      });
      expect(detail.images.map(({ id }) => id)).toEqual([second.id, third.id]);
      expect(detail.image?.id).toBe(second.id);
    });
  });

  describe('detail (UC-CAT-02)', () => {
    it('shows only the sellable variants, the visible categories and the brand even when inactive', async () => {
      const brand = await createBrand('Marca Vieja');
      const [shirts, summer, hidden] = [
        await createCategory('Camisas'),
        await createCategory('Árbol de verano'),
        await createCategory('Oculta'),
      ];
      const id = await createProduct('Camisa de lino', {
        brandId: brand,
        categoryIds: [shirts, summer, hidden],
        description: 'Fresca.',
      });
      const small = await addVariant(id, 'CAM-S', {
        talla: 'S',
        color: 'Azul',
      });
      const medium = await addVariant(id, 'CAM-M', {
        talla: 'M',
        color: 'Azul',
      });
      await addVariant(id, 'CAM-L', { talla: 'L', color: 'Azul' });
      await price(small, 59_900, { compareAt: 79_900 });
      await price(medium, 49_900);
      await stock(medium, 1);
      await publish(id);
      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(brand));
      await run(() => moduleRef.get(DeactivateCategory).execute(hidden));

      const detail = await storefront.product('camisa-de-lino');

      expect(detail).toEqual({
        id,
        slug: 'camisa-de-lino',
        title: 'Camisa de lino',
        brand: { id: brand, name: 'Marca Vieja', slug: 'marca-vieja' },
        fromPrice: mxn(49_900),
        compareAtPrice: null,
        available: true,
        image: null,
        publishedAt: expect.any(Date) as Date,
        description: 'Fresca.',
        categories: [
          { id: summer, name: 'Árbol de verano', slug: 'arbol-de-verano' },
          { id: shirts, name: 'Camisas', slug: 'camisas' },
        ],
        images: [],
        optionNames: ['color', 'talla'],
        variants: [
          {
            id: small,
            sku: 'CAM-S',
            options: { talla: 'S', color: 'Azul' },
            price: mxn(59_900),
            compareAtPrice: mxn(79_900),
            available: false,
          },
          {
            id: medium,
            sku: 'CAM-M',
            options: { talla: 'M', color: 'Azul' },
            price: mxn(49_900),
            compareAtPrice: null,
            available: true,
          },
        ],
      });
    });

    it('answers 404 for a product that does not exist, is not published or has no sellable variant', async () => {
      await createProduct('Borrador');
      const unpriced = await createProduct('Sin precio');
      await addVariant(unpriced, 'SIN-1');
      await publish(unpriced);
      const archived = await onSale('Archivado', 1_000);
      await archive(archived.id);

      for (const slug of [
        'no-existe',
        'borrador',
        'sin-precio',
        'archivado',
        'No Es Un Slug',
        'a'.repeat(201),
      ]) {
        await expect(storefront.product(slug)).rejects.toThrow(NotFoundError);
      }
    });
  });

  describe('brands (API_SPEC.md §11.5)', () => {
    it('lists the active brands with a product the store shows, in Spanish order', async () => {
      const [nube, nandu, arbol, inactive, unsold] = [
        await createBrand('Nube'),
        await createBrand('Ñandú'),
        await createBrand('Árbol'),
        await createBrand('Inactiva'),
        await createBrand('Sin ventas'),
      ];
      for (const brandId of [nube, nandu, arbol, inactive]) {
        await onSale(`Producto ${brandId}`, 1_000, { brandId });
      }
      await createProduct('Borrador', { brandId: unsold });
      await run(() => moduleRef.get(ChangeBrandStatus).deactivate(inactive));

      expect(await storefront.brands()).toEqual([
        { id: arbol, name: 'Árbol', slug: 'arbol' },
        { id: nube, name: 'Nube', slug: 'nube' },
        { id: nandu, name: 'Ñandú', slug: 'nandu' },
      ]);
    });
  });

  describe('storeVisibility (UC-CAT-14, ADR-0129)', () => {
    it('tells the staff how the store sees each product, in the order asked', async () => {
      const visible = await onSale('Visible', 1_000);
      const unpriced = await createProduct('Sin precio');
      await addVariant(unpriced, 'SIN-1');
      await publish(unpriced);
      const discontinued = await createProduct('Descontinuado');
      await addVariant(discontinued, 'DES-1', { talla: 'S' });
      const dropped = await addVariant(discontinued, 'DES-2', { talla: 'M' });
      await price(dropped, 1_000);
      await publish(discontinued);
      await discontinue(discontinued, dropped);
      const draft = await createProduct('Borrador');
      await price(await addVariant(draft, 'BOR-1'), 1_000);
      const archived = await onSale('Archivado', 1_000);
      await archive(archived.id);

      expect(
        await storefront.visibilities([
          unpriced,
          visible.id,
          draft,
          discontinued,
          archived.id,
          newId<'Product'>(),
        ]),
      ).toEqual([
        'HIDDEN_NO_PRICE',
        'VISIBLE',
        'NOT_PUBLISHED',
        'HIDDEN_NO_PRICE',
        'NOT_PUBLISHED',
        'NOT_PUBLISHED',
      ]);
      expect(await storefront.visibilities([])).toEqual([]);
    });
  });
});
