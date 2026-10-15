import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  DuplicateValueError,
  newId,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CatalogQueries } from '../application/catalog.queries.js';
import { ImportProducts } from '../application/import-products.use-case.js';
import {
  MAX_PRODUCT_IMPORT_ROWS,
  ProductImportError,
  type ProductImportRow,
} from '../application/product-import.js';
import { CatalogModule } from '../catalog.module.js';
import {
  UnusableBrandError,
  UnusableCategoriesError,
} from '../domain/product-errors.js';
import { gtinKey } from '../domain/variant.js';

const EMPTY: Omit<ProductImportRow, 'line'> = {
  wellFormed: true,
  slug: '',
  title: '',
  description: '',
  brand: '',
  categories: '',
  sku: '',
  gtin: '',
  weightGrams: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  options: {},
};

/** Rows from line 2, as the file reader gives them, with the cells given and every other one empty. */
const rows = (
  ...cells: Partial<Omit<ProductImportRow, 'line'>>[]
): ProductImportRow[] =>
  cells.map((row, index) => ({ ...EMPTY, ...row, line: index + 2 }));

/** The clock of the API, which writes the dates of the products, not the one of PostgreSQL (ADR-0124). */
const NOW = new Date('2026-10-15T12:00:00.000Z');

/** An EAN-13 with its check digit, from 12 digits. */
function ean13(digits: string): string {
  const sum = [...digits]
    .map(Number)
    .reverse()
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );
  return `${digits}${(10 - (sum % 10)) % 10}`;
}

/** Bulk import of products against PostgreSQL 18 (T-146 part a, UC-CAT-16, ADR-0164). */
describe('Bulk import of products (T-146 part a)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;

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
      .useValue({ now: () => NOW })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.productCategory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.brand.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: 'products.import' },
    });
  });

  const importRows = (fileRows: readonly ProductImportRow[], dryRun = false) =>
    cls.run(() => moduleRef.get(ImportProducts).execute(fileRows, { dryRun }));

  /** The rejected import's errors. */
  async function errorsOf(fileRows: readonly ProductImportRow[]) {
    const error = await importRows(fileRows).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProductImportError);
    return (error as ProductImportError).details?.errors;
  }

  async function createBrand(slug: string, status: 'ACTIVE' | 'INACTIVE') {
    const id = newId();
    await prisma.brand.create({ data: { id, name: slug, slug, status } });
    return id;
  }

  async function createCategory(slug: string, status: 'ACTIVE' | 'INACTIVE') {
    const id = newId();
    await prisma.category.create({ data: { id, name: slug, slug, status } });
    return id;
  }

  /** Whether the store's search would find the product with this word, as a prefix (ADR-0060). */
  async function found(slug: string, word: string): Promise<boolean> {
    const [row] = await prisma.$queryRaw<{ found: boolean }[]>`
      SELECT coalesce(search_vector @@ to_tsquery('spanish', unaccent(${word}) || ':*'), false) AS found
        FROM products WHERE slug = ${slug}`;
    return row.found;
  }

  const counts = async () => ({
    products: await prisma.product.count(),
    categories: await prisma.productCategory.count(),
    variants: await prisma.productVariant.count(),
    audits: await prisma.auditLog.count({
      where: { action: 'products.import' },
    }),
  });

  it('creates the products in DRAFT with their categories and variants, searchable, and audits the import once', async () => {
    const brand = await createBrand('marca-ejemplo', 'ACTIVE');
    const shirts = await createCategory('camisas', 'ACTIVE');
    const men = await createCategory('hombre', 'ACTIVE');

    const summary = await importRows(
      rows(
        {
          slug: 'camisa-lino',
          title: 'Camisa de lino',
          description: 'Fresca y ligera.',
          brand: 'marca-ejemplo',
          categories: 'camisas|hombre',
          sku: 'cam-lin-m',
          gtin: '7501055363063',
          weightGrams: '250',
          lengthCm: '30.5',
          options: { talla: 'M' },
        },
        { slug: 'camisa-lino', sku: 'CAM-LIN-G', options: { talla: 'G' } },
        { slug: 'gorra', title: 'Gorra azul', sku: 'GORRA-AZUL' },
      ),
    );

    expect(summary).toEqual({
      rows: 3,
      products: 2,
      variants: 3,
      dryRun: false,
    });
    const products = await prisma.product.findMany({
      include: {
        categories: { select: { categoryId: true } },
        variants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
      orderBy: { slug: 'asc' },
    });
    expect(products).toEqual([
      expect.objectContaining({
        slug: 'camisa-lino',
        title: 'Camisa de lino',
        description: 'Fresca y ligera.',
        brandId: brand,
        status: 'DRAFT',
        version: 1,
        categories: expect.arrayContaining([
          { categoryId: shirts },
          { categoryId: men },
        ]),
        variants: [
          expect.objectContaining({
            sku: 'CAM-LIN-M',
            gtin: '7501055363063',
            gtinKey: '07501055363063',
            options: { talla: 'M' },
            status: 'ACTIVE',
            weightGrams: 250,
          }),
          expect.objectContaining({
            sku: 'CAM-LIN-G',
            gtin: null,
            gtinKey: null,
            options: { talla: 'G' },
          }),
        ],
      }),
      expect.objectContaining({
        slug: 'gorra',
        brandId: null,
        categories: [],
        variants: [expect.objectContaining({ sku: 'GORRA-AZUL' })],
      }),
    ]);
    expect(products[0].variants[0].lengthCm?.toNumber()).toBe(30.5);
    expect(
      [products[0], ...products[0].variants].map(({ createdAt, updatedAt }) => [
        createdAt,
        updatedAt,
      ]),
    ).toEqual([
      [NOW, NOW],
      [NOW, NOW],
      [NOW, NOW],
    ]);
    // The same view as a product created one by one.
    expect(
      await moduleRef.get(CatalogQueries).findProduct(products[0].id as never),
    ).toMatchObject({
      brand: { id: brand },
      status: 'DRAFT',
      firstPublishedAt: null,
    });
    expect([
      await found('camisa-lino', 'lino'),
      await found('camisa-lino', 'ejemplo'),
      await found('camisa-lino', 'hombre'),
      await found('gorra', 'azul'),
    ]).toEqual([true, true, true, true]);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'products.import' },
    });
    expect(audits).toEqual([
      expect.objectContaining({
        resourceType: 'product-import',
        result: 'SUCCESS',
        changes: {
          rows: { from: null, to: 3 },
          products: { from: null, to: 2 },
          variants: { from: null, to: 3 },
          productIds: {
            from: null,
            to: expect.arrayContaining(products.map(({ id }) => id)),
          },
        },
      }),
    ]);
  });

  it('with dryRun, runs the writes and rolls them back', async () => {
    await createCategory('camisas', 'ACTIVE');

    const summary = await importRows(
      rows(
        {
          slug: 'camisa',
          title: 'Camisa',
          categories: 'camisas',
          sku: 'CAM-M',
          options: { talla: 'M' },
        },
        { slug: 'camisa', sku: 'CAM-G', options: { talla: 'G' } },
      ),
      true,
    );

    expect(summary).toEqual({
      rows: 2,
      products: 1,
      variants: 2,
      dryRun: true,
    });
    expect(await counts()).toEqual({
      products: 0,
      categories: 0,
      variants: 0,
      audits: 0,
    });
  });

  it('answers the slugs, the SKUs ever used and the GTINs of active variants the catalog has, and imports nothing', async () => {
    const productId = newId();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Existente',
        slug: 'existente',
        status: 'ARCHIVED',
      },
    });
    await prisma.productVariant.createMany({
      data: [
        {
          id: newId(),
          productId,
          sku: 'USADO',
          gtin: '036000291452',
          gtinKey: gtinKey('036000291452'),
          options: { n: '1' },
          status: 'DISCONTINUED',
        },
        {
          id: newId(),
          productId,
          sku: 'ACTIVO',
          gtin: '7501055363063',
          gtinKey: gtinKey('7501055363063'),
          options: { n: '2' },
          status: 'ACTIVE',
        },
      ],
    });

    expect(
      await errorsOf(
        rows(
          { slug: 'existente', title: 'Otra', sku: 'NUEVO-1' },
          { slug: 'nueva', title: 'Nueva', sku: 'usado', options: {} },
          {
            slug: 'otra',
            title: 'Otra',
            sku: 'NUEVO-2',
            gtin: '7501055363063',
          },
          // A discontinued variant leaves its GTIN free, also with another number of leading zeros.
          {
            slug: 'mas',
            title: 'Más',
            sku: 'NUEVO-3',
            gtin: '0036000291452',
          },
        ),
      ),
    ).toEqual([
      expect.objectContaining({ field: 'rows[2].slug', code: 'taken' }),
      expect.objectContaining({ field: 'rows[3].sku', code: 'taken' }),
      expect.objectContaining({ field: 'rows[4].gtin', code: 'taken' }),
    ]);
    expect(await counts()).toEqual({
      products: 1,
      categories: 0,
      variants: 2,
      audits: 0,
    });
  });

  it('finds the brand and the categories by slug, and answers those inactive or missing', async () => {
    await createBrand('marca-retirada', 'INACTIVE');
    await createCategory('oculta', 'INACTIVE');
    await createCategory('camisas', 'ACTIVE');

    expect(
      await errorsOf(
        rows(
          {
            slug: 'camisa',
            title: 'Camisa',
            brand: 'marca-retirada',
            categories: 'camisas|oculta',
            sku: 'A',
          },
          {
            slug: 'gorra',
            title: 'Gorra',
            brand: 'sin-marca',
            categories: 'nueva',
            sku: 'B',
          },
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        field: 'rows[2].brand',
        code: 'inactiveBrand',
      }),
      expect.objectContaining({
        field: 'rows[2].categories',
        code: 'inactiveCategories',
      }),
      expect.objectContaining({
        field: 'rows[3].brand',
        code: 'unknownBrand',
      }),
      expect.objectContaining({
        field: 'rows[3].categories',
        code: 'unknownCategories',
      }),
    ]);
  });

  it('answers 409 when another change takes a slug after the checks, and saves nothing of the file', async () => {
    // Another session creates the same slug and keeps its transaction open, so the import's checks do not see it.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      "INSERT INTO products (id, title, slug, status, updated_at) VALUES ($1, 'Camisa', 'camisa', 'DRAFT', now())",
      [newId()],
    );

    const result = importRows(
      rows(
        { slug: 'gorra', title: 'Gorra', sku: 'GORRA' },
        { slug: 'camisa', title: 'Camisa', sku: 'CAMISA' },
      ),
    ).catch((error: unknown) => error);
    await waitForLockWaiters(1);
    await holder.query('COMMIT');
    await holder.end();

    expect(await result).toEqual(new DuplicateValueError('slug'));
    expect(await counts()).toEqual({
      products: 1,
      categories: 0,
      variants: 0,
      audits: 0,
    });
  });

  it.each([
    [
      'brand',
      "DELETE FROM brands WHERE slug = 'marca-ejemplo'",
      new UnusableBrandError('unknown'),
    ],
    [
      'category',
      "DELETE FROM categories WHERE slug = 'camisas'",
      new UnusableCategoriesError('unknown'),
    ],
  ])(
    'answers a %s deleted after the checks as unknown, and saves nothing of the file',
    async (_, deletion, expected) => {
      await createBrand('marca-ejemplo', 'ACTIVE');
      await createCategory('camisas', 'ACTIVE');
      // Another session deletes it and keeps its transaction open, so the import's checks still see it.
      const holder = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query(deletion);

      const result = importRows(
        rows({
          slug: 'camisa',
          title: 'Camisa',
          brand: 'marca-ejemplo',
          categories: 'camisas',
          sku: 'CAMISA',
        }),
      ).catch((error: unknown) => error);
      await waitForLockWaiters(1);
      await holder.query('COMMIT');
      await holder.end();

      expect(await result).toEqual(expected);
      expect(await counts()).toEqual({
        products: 0,
        categories: 0,
        variants: 0,
        audits: 0,
      });
    },
  );

  it(`imports ${MAX_PRODUCT_IMPORT_ROWS} products with 10 categories each within the time limit of a transaction`, async () => {
    const categories = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createCategory(`categoria-${index}`, 'ACTIVE'),
      ),
    );
    const description = 'Descripción larga de un producto. '.repeat(30);

    const summary = await importRows(
      rows(
        ...Array.from({ length: MAX_PRODUCT_IMPORT_ROWS }, (_, index) => {
          const n = String(index).padStart(5, '0');
          return {
            slug: `producto-${n}`,
            title: `Producto ${n}`,
            description,
            categories: Array.from(
              { length: 10 },
              (__, category) => `categoria-${category}`,
            ).join('|'),
            sku: `SKU-${n}`,
            gtin: ean13(`7501055${n}`),
            weightGrams: '250',
            options: { talla: 'Única' },
          };
        }),
      ),
    );

    expect(summary.products).toBe(MAX_PRODUCT_IMPORT_ROWS);
    expect(await counts()).toEqual({
      products: MAX_PRODUCT_IMPORT_ROWS,
      categories: MAX_PRODUCT_IMPORT_ROWS * categories.length,
      variants: MAX_PRODUCT_IMPORT_ROWS,
      audits: 1,
    });
    expect(await found('producto-04999', 'categoria')).toBe(true);
  }, 120_000);
});
