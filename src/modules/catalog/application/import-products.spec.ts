import {
  type AuditEntry,
  type AuditTrail,
  toId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import { Brand, type BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import type { CatalogStatus } from '../domain/catalog-values.js';
import { Category, type CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import type { Product } from '../domain/product.js';
import type { ProductId } from '../domain/product-id.js';
import { ProductRepository } from '../domain/product.repository.js';
import { ImportProducts } from './import-products.use-case.js';
import { ProductImportError, type ProductImportRow } from './product-import.js';
import type { ProductSearchIndex } from './product-search-index.js';

const MARCA = toId<'Brand'>('0199e0a1-0000-7000-8000-000000000001');
const RETIRADA = toId<'Brand'>('0199e0a1-0000-7000-8000-000000000002');
const CAMISAS = toId<'Category'>('0199e0a1-0000-7000-8000-000000000011');
const HOMBRE = toId<'Category'>('0199e0a1-0000-7000-8000-000000000012');
const OCULTA = toId<'Category'>('0199e0a1-0000-7000-8000-000000000013');
const NOW = new Date('2026-10-15T18:00:00.000Z');

class InMemoryProducts extends ProductRepository {
  readonly inserted: Product[] = [];
  readonly insertedAt: Date[] = [];

  constructor(
    private readonly taken: {
      slugs?: string[];
      skus?: string[];
      gtinKeys?: string[];
    } = {},
  ) {
    super();
  }

  findById(): Promise<Product | null> {
    throw new Error('Not used by the import');
  }

  save(): Promise<void> {
    throw new Error('Not used by the import');
  }

  insertNew(products: readonly Product[], now: Date): Promise<void> {
    this.inserted.push(...products);
    this.insertedAt.push(now);
    return Promise.resolve();
  }

  takenSlugs(slugs: readonly string[]): Promise<ReadonlySet<string>> {
    return Promise.resolve(of(slugs, this.taken.slugs));
  }

  takenSkus(skus: readonly string[]): Promise<ReadonlySet<string>> {
    return Promise.resolve(of(skus, this.taken.skus));
  }

  takenGtinKeys(keys: readonly string[]): Promise<ReadonlySet<string>> {
    return Promise.resolve(of(keys, this.taken.gtinKeys));
  }
}

function of(
  wanted: readonly string[],
  taken: readonly string[] = [],
): ReadonlySet<string> {
  return new Set(wanted.filter((value) => taken.includes(value)));
}

class InMemoryBrands extends BrandRepository {
  private readonly brands = [
    brand(MARCA, 'marca-ejemplo', 'ACTIVE'),
    brand(RETIRADA, 'marca-retirada', 'INACTIVE'),
  ];

  findById(): Promise<Brand | null> {
    throw new Error('Not used by the import');
  }

  findBySlugs(slugs: readonly string[]): Promise<Brand[]> {
    return Promise.resolve(
      this.brands.filter((stored) => slugs.includes(stored.snapshot().slug)),
    );
  }

  save(): Promise<void> {
    throw new Error('Not used by the import');
  }

  delete(): Promise<void> {
    throw new Error('Not used by the import');
  }

  takenSlugs(): Promise<ReadonlySet<string>> {
    throw new Error('Not used by the import');
  }
}

function brand(id: BrandId, slug: string, status: CatalogStatus): Brand {
  return Brand.restore({ id, name: slug, slug, status });
}

class InMemoryCategories extends CategoryRepository {
  private readonly categories = [
    category(CAMISAS, 'camisas', 'ACTIVE'),
    category(HOMBRE, 'hombre', 'ACTIVE'),
    category(OCULTA, 'oculta', 'INACTIVE'),
  ];

  findById(): Promise<Category | null> {
    throw new Error('Not used by the import');
  }

  findByIds(): Promise<Category[]> {
    throw new Error('Not used by the import');
  }

  findBySlugs(slugs: readonly string[]): Promise<Category[]> {
    return Promise.resolve(
      this.categories.filter((stored) =>
        slugs.includes(stored.snapshot().slug),
      ),
    );
  }

  save(): Promise<void> {
    throw new Error('Not used by the import');
  }

  delete(): Promise<void> {
    throw new Error('Not used by the import');
  }

  lineage(): Promise<CategoryId[]> {
    throw new Error('Not used by the import');
  }

  takenSlugs(): Promise<ReadonlySet<string>> {
    throw new Error('Not used by the import');
  }

  lockTree(): Promise<void> {
    throw new Error('Not used by the import');
  }
}

function category(
  id: CategoryId,
  slug: string,
  status: CatalogStatus,
): Category {
  return Category.restore({
    id,
    parentId: null,
    name: slug,
    slug,
    status,
    position: 0,
  });
}

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
  storeOnly: '',
  options: {},
};

/** A row of the file at `line`, with the cells given and every other one empty. */
const row = (
  line: number,
  cells: Partial<Omit<ProductImportRow, 'line'>>,
): ProductImportRow => ({ ...EMPTY, ...cells, line });

/** A product with one variant per SKU, in the rows from `line`. */
const product = (
  line: number,
  slug: string,
  ...skus: string[]
): ProductImportRow[] =>
  skus.map((sku, index) =>
    row(line + index, {
      slug,
      title: index === 0 ? `Producto ${slug}` : '',
      sku,
      options: skus.length > 1 ? { talla: `T${index}` } : {},
    }),
  );

function setUp(taken: ConstructorParameters<typeof InMemoryProducts>[0] = {}) {
  const products = new InMemoryProducts(taken);
  const refreshed: ProductId[] = [];
  const searchIndex = {
    refreshProducts: (ids: readonly ProductId[]) => {
      refreshed.push(...ids);
      return Promise.resolve();
    },
  } as unknown as ProductSearchIndex;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  return {
    importProducts: new ImportProducts(
      products,
      new InMemoryBrands(),
      new InMemoryCategories(),
      searchIndex,
      inline,
      audit,
      { now: () => NOW },
    ),
    products,
    refreshed,
    audited,
  };
}

/** The errors of importing `rows`, which must fail. */
async function errorsOf(
  rows: readonly ProductImportRow[],
  taken: ConstructorParameters<typeof InMemoryProducts>[0] = {},
): Promise<unknown> {
  const { importProducts, products, audited } = setUp(taken);
  const error: unknown = await importProducts
    .execute(rows, { dryRun: false })
    .then(
      () => {
        throw new Error('The file was imported');
      },
      (thrown: unknown) => thrown,
    );
  expect(error).toBeInstanceOf(ProductImportError);
  expect([products.inserted, audited]).toEqual([[], []]);
  return (error as ProductImportError).details?.errors;
}

const fieldsOf = async (
  rows: readonly ProductImportRow[],
  taken?: ConstructorParameters<typeof InMemoryProducts>[0],
) =>
  ((await errorsOf(rows, taken)) as { field: string; code: string }[]).map(
    ({ field, code }) => `${field} ${code}`,
  );

describe('ImportProducts (UC-CAT-16, ADR-0164)', () => {
  it('creates a product in DRAFT per slug, with a variant per row, refreshes their search and audits the import once', async () => {
    const { importProducts, products, refreshed, audited } = setUp();

    const summary = await importProducts.execute(
      [
        row(2, {
          slug: 'camisa-lino',
          title: 'Camisa de lino',
          description: 'Fresca y ligera.',
          brand: 'Marca-Ejemplo',
          categories: 'camisas | HOMBRE||camisas|',
          sku: 'cam-lin-m',
          gtin: '7501055363063',
          weightGrams: '250',
          lengthCm: '30',
          widthCm: '20.5',
          heightCm: '3',
          options: { talla: 'M', color: 'Blanco' },
        }),
        // The next rows of a product may repeat its data, whatever the case of the slugs and the order.
        row(3, {
          slug: 'camisa-lino',
          title: 'Camisa de lino',
          description: 'Fresca y ligera.',
          brand: 'marca-ejemplo',
          categories: 'hombre|camisas',
          sku: 'CAM-LIN-G',
          options: { talla: 'G', color: 'Blanco' },
        }),
        row(4, { slug: 'gorra', title: 'Gorra', sku: 'gorra-azul' }),
      ],
      { dryRun: false },
    );

    expect(summary).toEqual({
      rows: 3,
      products: 2,
      variants: 3,
      dryRun: false,
    });
    const [camisa, gorra] = products.inserted.map((created) =>
      created.snapshot(),
    );
    expect(camisa).toEqual({
      id: expect.any(String),
      title: 'Camisa de lino',
      slug: 'camisa-lino',
      description: 'Fresca y ligera.',
      brandId: MARCA,
      categoryIds: [CAMISAS, HOMBRE],
      status: 'DRAFT',
      publishedAt: null,
      archivedAt: null,
      firstPublishedAt: null,
      storeOnly: false,
      version: 1,
      variants: [
        {
          id: expect.any(String),
          sku: 'CAM-LIN-M',
          gtin: '7501055363063',
          options: { talla: 'M', color: 'Blanco' },
          status: 'ACTIVE',
          weightGrams: 250,
          lengthCm: 30,
          widthCm: 20.5,
          heightCm: 3,
        },
        {
          id: expect.any(String),
          sku: 'CAM-LIN-G',
          gtin: null,
          options: { talla: 'G', color: 'Blanco' },
          status: 'ACTIVE',
          weightGrams: null,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
        },
      ],
    });
    expect(gorra).toMatchObject({
      slug: 'gorra',
      title: 'Gorra',
      description: null,
      brandId: null,
      categoryIds: [],
      variants: [{ sku: 'GORRA-AZUL', options: {} }],
    });
    expect(products.insertedAt).toEqual([NOW]);
    expect(refreshed).toEqual([camisa.id, gorra.id]);
    expect(audited).toEqual([
      {
        action: 'products.import',
        resource: { type: 'product-import', id: expect.any(String) },
        changes: {
          rows: { from: null, to: 3 },
          products: { from: null, to: 2 },
          variants: { from: null, to: 3 },
          productIds: { from: null, to: [camisa.id, gorra.id] },
        },
      },
    ]);
  });

  it('with dryRun, answers what it would do and audits nothing', async () => {
    const { importProducts, audited } = setUp();

    await expect(
      importProducts.execute(product(2, 'camisa', 'CAM-M', 'CAM-G'), {
        dryRun: true,
      }),
    ).resolves.toEqual({ rows: 2, products: 1, variants: 2, dryRun: true });
    expect(audited).toEqual([]);
  });

  it.each([
    ['slug', { slug: '' }, 'isNotEmpty'],
    ['slug', { slug: 'Camisa Lino' }, 'slug'],
    ['slug', { slug: 'camisa--lino' }, 'slug'],
    ['slug', { slug: 'a'.repeat(201) }, 'slug'],
    ['title', { title: 'a'.repeat(201) }, 'maxLength'],
    ['description', { description: 'a'.repeat(10_001) }, 'maxLength'],
    [
      'categories',
      {
        categories: Array.from({ length: 11 }, (_, i) => `c${i}`).join('|'),
      },
      'arrayMaxSize',
    ],
    ['sku', { sku: '' }, 'isNotEmpty'],
    ['sku', { sku: 'CAM LIN' }, 'matches'],
    ['sku', { sku: 'A'.repeat(65) }, 'matches'],
    ['gtin', { gtin: '750105536306' }, 'gtinCheckDigit'],
    ['gtin', { gtin: '75010553630' }, 'matches'],
    ['gtin', { gtin: '7501055363o63' }, 'matches'],
    ['weightGrams', { weightGrams: '0' }, 'grams'],
    ['weightGrams', { weightGrams: '250.5' }, 'grams'],
    ['weightGrams', { weightGrams: '2147483648' }, 'grams'],
    ['lengthCm', { lengthCm: '0' }, 'centimeters'],
    ['widthCm', { widthCm: '30.25' }, 'centimeters'],
    ['heightCm', { heightCm: '30,5' }, 'centimeters'],
    ['heightCm', { heightCm: '1000000' }, 'centimeters'],
    ['option:talla', { options: { talla: 'a'.repeat(51) } }, 'maxLength'],
    [
      'options',
      { options: { talla: 'M', color: 'Azul', corte: 'Slim', manga: 'Larga' } },
      'options',
    ],
  ])('answers an invalid %s with %p as %s', async (column, cells, code) => {
    const fields = await fieldsOf([
      row(2, { slug: 'camisa', title: 'Camisa', sku: 'CAM-M', ...cells }),
    ]);

    expect(fields).toContain(`rows[2].${column} ${code}`);
  });

  it('takes the longest values and the smallest measures', async () => {
    const { importProducts, products } = setUp();

    await importProducts.execute(
      [
        row(2, {
          slug: 'a'.repeat(200),
          title: 'a'.repeat(200),
          description: 'a'.repeat(10_000),
          categories: 'camisas',
          sku: 'A'.repeat(64),
          gtin: '01234565',
          weightGrams: '2147483647',
          lengthCm: '0.1',
          widthCm: '999999.9',
          heightCm: '1',
          options: { talla: 'a'.repeat(50), color: 'b', corte: 'c' },
        }),
      ],
      { dryRun: false },
    );

    expect(products.inserted[0].snapshot().variants[0]).toMatchObject({
      weightGrams: 2_147_483_647,
      lengthCm: 0.1,
      widthCm: 999_999.9,
    });
  });

  it('counts the categories without repeats, up to 10', async () => {
    const { importProducts, products } = setUp();
    await importProducts.execute(
      [
        row(2, {
          slug: 'camisa',
          title: 'Camisa',
          categories: Array.from({ length: 11 }, () => 'camisas').join('|'),
          sku: 'A',
        }),
      ],
      { dryRun: false },
    );

    expect(products.inserted[0].snapshot().categoryIds).toEqual([CAMISAS]);
    // Ten categories are not too many: these are only missing.
    expect(
      await fieldsOf([
        row(2, {
          slug: 'camisa',
          title: 'Camisa',
          categories: Array.from({ length: 10 }, (_, i) => `c${i}`).join('|'),
          sku: 'A',
        }),
      ]),
    ).toEqual(['rows[2].categories unknownCategories']);
  });

  it('sells a product only in the store with storeOnly, whatever its case, and online with false or nothing', async () => {
    const { importProducts, products } = setUp();

    await importProducts.execute(
      [
        row(2, {
          slug: 'revision',
          title: 'Revisión de equipo',
          sku: 'SERV-1',
          storeOnly: 'TRUE',
          options: { nivel: 'Básica' },
        }),
        // The next rows repeat it or leave it empty.
        row(3, {
          slug: 'revision',
          sku: 'SERV-2',
          storeOnly: 'true',
          options: { nivel: 'Completa' },
        }),
        row(4, {
          slug: 'revision',
          sku: 'SERV-3',
          options: { nivel: 'Express' },
        }),
        row(5, {
          slug: 'gorra',
          title: 'Gorra',
          sku: 'G-1',
          storeOnly: 'False',
        }),
        row(6, {
          slug: 'camisa',
          title: 'Camisa',
          sku: 'C-1',
          options: { talla: 'M' },
        }),
        // An empty storeOnly is false, so false repeats it.
        row(7, {
          slug: 'camisa',
          sku: 'C-2',
          storeOnly: 'FALSE',
          options: { talla: 'G' },
        }),
      ],
      { dryRun: false },
    );

    expect(
      products.inserted.map((created) => [
        created.snapshot().slug,
        created.snapshot().storeOnly,
      ]),
    ).toEqual([
      ['revision', true],
      ['gorra', false],
      ['camisa', false],
    ]);
  });

  it('answers a storeOnly that is not true or false, without checking the variants of its product, or that differs from the first row', async () => {
    expect(
      await fieldsOf([
        row(2, { slug: 'gorra', title: 'Gorra', sku: 'G-1', storeOnly: 'sí' }),
        // Other option names, unchecked while the product has errors.
        row(3, { slug: 'gorra', sku: 'G-2', options: { talla: 'M' } }),
        row(4, { slug: 'gorra', sku: 'G-3', options: { color: 'Rojo' } }),
        row(5, {
          slug: 'camisa',
          title: 'Camisa',
          sku: 'C-1',
          options: { talla: 'M' },
        }),
        row(6, {
          slug: 'camisa',
          sku: 'C-2',
          storeOnly: 'true',
          options: { talla: 'G' },
        }),
      ]),
    ).toEqual([
      'rows[2].storeOnly isBoolean',
      'rows[6].storeOnly differsFromProduct',
    ]);
  });

  it('answers a row with another number of cells as an error of the whole row', async () => {
    expect(
      await fieldsOf([
        {
          ...row(2, { slug: 'camisa', title: 'C', sku: 'A' }),
          wellFormed: false,
        },
      ]),
    ).toEqual(['rows[2] columnCount']);
  });

  it('requires the title in the first row of each product', async () => {
    expect(
      await fieldsOf([
        row(2, { slug: 'camisa', sku: 'CAM-M', options: { talla: 'M' } }),
        row(3, {
          slug: 'camisa',
          title: 'Camisa',
          sku: 'CAM-G',
          options: { talla: 'G' },
        }),
      ]),
    ).toEqual(['rows[2].title isNotEmpty', 'rows[3].title differsFromProduct']);
  });

  it('answers each product column of a later row that differs from the first one', async () => {
    const first = {
      slug: 'camisa',
      title: 'Camisa',
      description: 'Ligera.',
      brand: 'marca-ejemplo',
      categories: 'camisas',
    };

    expect(
      await fieldsOf([
        row(2, { ...first, sku: 'CAM-1', options: { talla: '1' } }),
        row(3, {
          slug: 'camisa',
          title: 'Camisa larga',
          description: 'Pesada.',
          brand: 'marca-retirada',
          categories: 'camisas|hombre',
          sku: 'CAM-2',
          options: { talla: '2' },
        }),
      ]),
    ).toEqual([
      'rows[3].title differsFromProduct',
      'rows[3].description differsFromProduct',
      'rows[3].brand differsFromProduct',
      'rows[3].categories differsFromProduct',
    ]);
  });

  it('answers a SKU or a GTIN repeated in the file in the later rows, whatever the case or the leading zeros', async () => {
    expect(
      await fieldsOf([
        row(2, {
          slug: 'camisa',
          title: 'Camisa',
          sku: 'cam-m',
          gtin: '036000291452',
          options: { talla: 'M' },
        }),
        row(3, {
          slug: 'camisa',
          sku: 'CAM-M',
          gtin: '0036000291452',
          options: { talla: 'G' },
        }),
        row(4, { slug: 'gorra', title: 'Gorra', sku: 'Cam-M' }),
      ]),
    ).toEqual([
      'rows[3].sku repeated',
      'rows[3].gtin repeated',
      'rows[4].sku repeated',
    ]);
  });

  it('answers the slugs, SKUs and GTINs the catalog already has', async () => {
    expect(
      await fieldsOf(
        [
          row(2, {
            slug: 'camisa',
            title: 'Camisa',
            sku: 'cam-m',
            gtin: '036000291452',
            options: { talla: 'M' },
          }),
          row(3, { slug: 'camisa', sku: 'CAM-G', options: { talla: 'G' } }),
        ],
        {
          slugs: ['camisa'],
          skus: ['CAM-M'],
          gtinKeys: ['00036000291452'],
        },
      ),
    ).toEqual([
      'rows[2].slug taken',
      'rows[2].sku taken',
      'rows[2].gtin taken',
    ]);
  });

  it('answers a brand or categories that are missing or inactive in the first row of the product', async () => {
    const errors = await errorsOf([
      row(2, {
        slug: 'camisa',
        title: 'Camisa',
        brand: 'sin-marca',
        categories: 'camisas|nueva|otra',
        sku: 'A',
      }),
      row(3, {
        slug: 'gorra',
        title: 'Gorra',
        brand: 'marca-retirada',
        categories: 'oculta|hombre',
        sku: 'B',
      }),
    ]);

    expect(errors).toEqual([
      {
        field: 'rows[2].brand',
        code: 'unknownBrand',
        message: 'No existe una marca con este slug.',
      },
      {
        field: 'rows[2].categories',
        code: 'unknownCategories',
        message: 'No existen categorías con estos slugs: nueva, otra.',
      },
      {
        field: 'rows[3].brand',
        code: 'inactiveBrand',
        message: 'La marca está inactiva.',
      },
      {
        field: 'rows[3].categories',
        code: 'inactiveCategories',
        message: 'Estas categorías están inactivas: oculta.',
      },
    ]);
  });

  it('lists the first 5 missing categories and how many more', async () => {
    const errors = (await errorsOf([
      row(2, {
        slug: 'camisa',
        title: 'Camisa',
        categories: 'a|b|c|d|e|f|g',
        sku: 'A',
      }),
    ])) as { message: string }[];

    expect(errors[0].message).toBe(
      'No existen categorías con estos slugs: a, b, c, d, e y 2 más.',
    );
    const five = (await errorsOf([
      row(2, {
        slug: 'camisa',
        title: 'Camisa',
        categories: 'a|b|c|d|e',
        sku: 'A',
      }),
    ])) as { message: string }[];
    expect(five[0].message).toBe(
      'No existen categorías con estos slugs: a, b, c, d, e.',
    );
  });

  it('requires the same option names in every variant of a product, and another combination in each', async () => {
    const errors = await errorsOf([
      row(2, {
        slug: 'camisa',
        title: 'Camisa',
        sku: 'A',
        options: { talla: 'M', color: 'Azul' },
      }),
      row(3, { slug: 'camisa', sku: 'B', options: { talla: 'G', color: '' } }),
      row(4, {
        slug: 'camisa',
        sku: 'C',
        options: { talla: 'M', color: 'Azul' },
      }),
      row(5, { slug: 'gorra', title: 'Gorra', sku: 'D' }),
      row(6, { slug: 'gorra', sku: 'E' }),
    ]);

    expect(errors).toEqual([
      {
        field: 'rows[3].options',
        code: 'optionNames',
        message:
          'Debe tener las mismas opciones que las demás variantes del producto: color, talla.',
      },
      {
        field: 'rows[4].options',
        code: 'repeated',
        message:
          'Otra variante del producto ya tiene esta combinación de opciones.',
      },
      {
        field: 'rows[6].options',
        code: 'repeated',
        message:
          'Otra variante del producto ya tiene esta combinación de opciones.',
      },
    ]);
  });

  it('checks the variants of a product whose first row has an error in its variant', async () => {
    expect(
      await fieldsOf([
        row(2, {
          slug: 'camisa',
          title: 'Camisa',
          sku: 'A',
          weightGrams: '0',
          options: { talla: 'M' },
        }),
        row(3, { slug: 'camisa', sku: 'B', options: { talla: 'G' } }),
        row(4, { slug: 'camisa', sku: 'C', options: { talla: 'G' } }),
      ]),
    ).toEqual(['rows[2].weightGrams grams', 'rows[4].options repeated']);
  });

  it('does not check the variants of a product whose data has errors', async () => {
    expect(
      await fieldsOf([
        row(2, {
          slug: 'camisa',
          title: 'a'.repeat(201),
          sku: 'A',
          options: { talla: 'M' },
        }),
        row(3, { slug: 'camisa', sku: 'B', options: { talla: 'M' } }),
      ]),
    ).toEqual(['rows[2].title maxLength']);
  });

  it('answers every error of the file, sorted by line', async () => {
    expect(
      await fieldsOf([
        row(2, { slug: 'camisa', title: 'Camisa', sku: '' }),
        row(3, { slug: '', title: 'Sin slug', sku: 'B', weightGrams: 'x' }),
        row(4, { slug: 'gorra', title: 'Gorra', sku: 'C', gtin: '1' }),
      ]),
    ).toEqual([
      'rows[2].sku isNotEmpty',
      'rows[3].slug isNotEmpty',
      'rows[3].weightGrams grams',
      'rows[4].gtin matches',
    ]);
  });
});
