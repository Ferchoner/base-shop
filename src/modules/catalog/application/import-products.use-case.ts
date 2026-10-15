import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  DuplicateValueError,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import type { CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import {
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  Product,
} from '../domain/product.js';
import { OptionNamesMismatchError } from '../domain/product-errors.js';
import { ProductRepository } from '../domain/product.repository.js';
import { MAX_PRODUCT_SLUG_LENGTH, SLUG_PATTERN } from '../domain/slug.js';
import {
  GTIN_PATTERN,
  gtinKey,
  MAX_OPTION_VALUE_LENGTH,
  MAX_OPTIONS,
  SKU_PATTERN,
  validGtin,
  type VariantOptions,
} from '../domain/variant.js';
import {
  categorySlugsFrom,
  centimetersFrom,
  gramsFrom,
  OPTION_COLUMN_PREFIX,
  type ProductImportRow,
  type ProductImportSummary,
  ProductRowErrors,
} from './product-import.js';
import { ProductSearchIndex } from './product-search-index.js';

/** The values of a row, each `undefined` when its cell is invalid; optional ones are `null` when empty. */
interface RowValues {
  readonly line: number;
  readonly slug: string | undefined;
  readonly title: string | undefined;
  readonly description: string | undefined;
  /** In lowercase, as slugs are. */
  readonly brand: string;
  readonly categories: readonly string[] | undefined;
  /** In uppercase, as SKUs are stored (BR-PRD-09). */
  readonly sku: string | undefined;
  readonly gtin: string | null | undefined;
  readonly weightGrams: number | null | undefined;
  readonly lengthCm: number | null | undefined;
  readonly widthCm: number | null | undefined;
  readonly heightCm: number | null | undefined;
  readonly options: VariantOptions | undefined;
  /** The cells of the product, as written, to compare the rows of a product. */
  readonly cells: ProductImportRow;
}

/** The rows of a product, in the order of the file; the first one has its data. */
interface ProductRows {
  readonly slug: string;
  readonly rows: RowValues[];
}

/** A product column of a row after the first: empty, or the same value. */
const PRODUCT_COLUMNS = [
  'title',
  'description',
  'brand',
  'categories',
] as const;

const REQUIRED = 'Es obligatorio.';
/** Most slugs an error lists. */
const MAX_SLUGS_LISTED = 5;

/** Ends the import of a dry run after every write, so its transaction rolls back. */
class DryRunFinished extends Error {}

/**
 * Bulk import of products with their variants (UC-CAT-16, ADR-0164): one row per variant, and the rows of a slug
 * are one new product in DRAFT, with the rules of `POST …/products` and `POST …/variants`. Every row is checked
 * first, against the others and against the catalog; with any error, nothing is imported and the answer lists
 * the errors by line. Otherwise every product is created in one transaction, with a few statements, and the import
 * is audited once. With `dryRun`, the same writes run and the transaction rolls back.
 */
@Injectable()
export class ImportProducts {
  constructor(
    private readonly products: ProductRepository,
    private readonly brands: BrandRepository,
    private readonly categories: CategoryRepository,
    private readonly searchIndex: ProductSearchIndex,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(
    rows: readonly ProductImportRow[],
    options: { dryRun: boolean },
  ): Promise<ProductImportSummary> {
    const errors = new ProductRowErrors();
    const values = rows.flatMap((row) => {
      const parsed = parseRow(row, errors);
      return parsed === null ? [] : [parsed];
    });
    const products = productsOf(values, errors);
    rejectRepeated(values, errors);
    await this.rejectTaken(products, values, errors);
    const brands = await this.brandsOf(products, errors);
    const categories = await this.categoriesOf(products, errors);
    const created = products.flatMap((product) => {
      const built = build(product, brands, categories, errors);
      return built === null ? [] : [built];
    });
    errors.throwIfAny();

    try {
      await this.transactions.run(async () => {
        await this.products.insertNew(created, this.clock.now());
        await this.searchIndex.refreshProducts(created.map(({ id }) => id));
        if (options.dryRun) throw new DryRunFinished();
        await this.audit.record({
          action: 'products.import',
          resource: { type: 'product-import', id: newId() },
          changes: changesBetween(
            {},
            {
              rows: rows.length,
              products: created.length,
              variants: rows.length,
              productIds: created.map(({ id }) => id),
            },
          ),
        });
      });
    } catch (error) {
      if (!(error instanceof DryRunFinished)) throw error;
    }
    return {
      rows: rows.length,
      products: created.length,
      variants: rows.length,
      dryRun: options.dryRun,
    };
  }

  /** Slugs, SKUs and GTINs the catalog already has, each with one query (BR-PRD-09, ADR-0163). */
  private async rejectTaken(
    products: readonly ProductRows[],
    values: readonly RowValues[],
    errors: ProductRowErrors,
  ): Promise<void> {
    const slugs = await this.products.takenSlugs(
      products.map(({ slug }) => slug),
    );
    for (const { slug, rows } of products) {
      if (slugs.has(slug)) {
        errors.add(
          rows[0].line,
          'slug',
          'taken',
          'Ya hay un producto con este slug, aunque esté archivado.',
        );
      }
    }
    const skus = await this.products.takenSkus(
      values.flatMap(({ sku }) => (sku === undefined ? [] : [sku])),
    );
    const keys = await this.products.takenGtinKeys(
      values.flatMap(({ gtin }) =>
        typeof gtin === 'string' ? [gtinKey(gtin)] : [],
      ),
    );
    for (const { line, sku, gtin } of values) {
      if (sku !== undefined && skus.has(sku)) {
        errors.add(
          line,
          'sku',
          'taken',
          'Ya hay una variante con este SKU, aunque esté descontinuada: un SKU no se reutiliza.',
        );
      }
      if (typeof gtin === 'string' && keys.has(gtinKey(gtin))) {
        errors.add(
          line,
          'gtin',
          'taken',
          'Otra variante activa ya tiene este GTIN.',
        );
      }
    }
  }

  /** The brands of the products by slug; one that is missing or inactive is an error of its first row. */
  private async brandsOf(
    products: readonly ProductRows[],
    errors: ProductRowErrors,
  ): Promise<ReadonlyMap<string, BrandId>> {
    const wanted = new Set(
      products.flatMap(({ rows }) =>
        rows[0].brand === '' ? [] : [rows[0].brand],
      ),
    );
    const found = new Map(
      (await this.brands.findBySlugs([...wanted])).map((brand) => [
        brand.snapshot().slug,
        brand.snapshot(),
      ]),
    );
    const usable = new Map<string, BrandId>();
    for (const { rows } of products) {
      const { line, brand } = rows[0];
      if (brand === '') continue;
      const stored = found.get(brand);
      if (stored === undefined) {
        errors.add(
          line,
          'brand',
          'unknownBrand',
          'No existe una marca con este slug.',
        );
      } else if (stored.status !== 'ACTIVE') {
        errors.add(line, 'brand', 'inactiveBrand', 'La marca está inactiva.');
      } else {
        usable.set(brand, stored.id);
      }
    }
    return usable;
  }

  /**
   * The IDs of the categories of the products by slug; those missing or inactive are an error of the first row of
   * their product, so the file is not imported.
   */
  private async categoriesOf(
    products: readonly ProductRows[],
    errors: ProductRowErrors,
  ): Promise<ReadonlyMap<string, CategoryId>> {
    const wanted = new Set(
      products.flatMap(({ rows }) => rows[0].categories ?? []),
    );
    const found = new Map(
      (await this.categories.findBySlugs([...wanted])).map((category) => [
        category.snapshot().slug,
        category.snapshot(),
      ]),
    );
    for (const { rows } of products) {
      const { line, categories } = rows[0];
      if (categories === undefined) continue;
      const unknown = categories.filter((slug) => !found.has(slug));
      const inactive = categories.filter(
        (slug) => found.get(slug)?.status === 'INACTIVE',
      );
      if (unknown.length > 0) {
        errors.add(
          line,
          'categories',
          'unknownCategories',
          `No existen categorías con estos slugs: ${listed(unknown)}.`,
        );
      } else if (inactive.length > 0) {
        errors.add(
          line,
          'categories',
          'inactiveCategories',
          `Estas categorías están inactivas: ${listed(inactive)}.`,
        );
      }
    }
    return new Map(
      [...found.values()].map((category) => [category.slug, category.id]),
    );
  }
}

/** The values of a row, or `null` after adding its error when it has another number of cells. */
function parseRow(
  row: ProductImportRow,
  errors: ProductRowErrors,
): RowValues | null {
  if (!row.wellFormed) {
    errors.add(
      row.line,
      null,
      'columnCount',
      'Debe tener tantos valores como columnas tiene el encabezado.',
    );
    return null;
  }
  const fail = (column: string, code: string, message: string) => {
    errors.add(row.line, column, code, message);
    return undefined;
  };
  const slug =
    row.slug === ''
      ? fail('slug', 'isNotEmpty', REQUIRED)
      : row.slug.length > MAX_PRODUCT_SLUG_LENGTH ||
          !SLUG_PATTERN.test(row.slug)
        ? fail(
            'slug',
            'slug',
            `Debe tener hasta ${MAX_PRODUCT_SLUG_LENGTH} minúsculas, dígitos y guiones, como camisa-lino.`,
          )
        : row.slug;
  const title =
    row.title.length > MAX_TITLE_LENGTH
      ? fail(
          'title',
          'maxLength',
          `Debe tener hasta ${MAX_TITLE_LENGTH} caracteres.`,
        )
      : row.title;
  const description =
    row.description.length > MAX_DESCRIPTION_LENGTH
      ? fail(
          'description',
          'maxLength',
          `Debe tener hasta ${MAX_DESCRIPTION_LENGTH.toLocaleString('en-US')} caracteres.`,
        )
      : row.description;
  const slugs = categorySlugsFrom(row.categories);
  const categories =
    slugs.length > MAX_CATEGORIES_PER_PRODUCT
      ? fail(
          'categories',
          'arrayMaxSize',
          `Debe tener hasta ${MAX_CATEGORIES_PER_PRODUCT} categorías.`,
        )
      : slugs;
  const sku =
    row.sku === ''
      ? fail('sku', 'isNotEmpty', REQUIRED)
      : SKU_PATTERN.test(row.sku)
        ? row.sku.toUpperCase()
        : fail(
            'sku',
            'matches',
            'Debe tener de 1 a 64 letras, dígitos, "-", "_" y ".".',
          );
  return {
    line: row.line,
    slug,
    title,
    description,
    brand: row.brand.toLowerCase(),
    categories,
    sku,
    gtin: gtinOf(row.gtin, fail),
    weightGrams: measureOf(row.weightGrams, gramsFrom, () =>
      fail(
        'weightGrams',
        'grams',
        'Debe ser un número entero de gramos mayor que 0.',
      ),
    ),
    lengthCm: measureOf(row.lengthCm, centimetersFrom, () =>
      fail('lengthCm', 'centimeters', CENTIMETERS),
    ),
    widthCm: measureOf(row.widthCm, centimetersFrom, () =>
      fail('widthCm', 'centimeters', CENTIMETERS),
    ),
    heightCm: measureOf(row.heightCm, centimetersFrom, () =>
      fail('heightCm', 'centimeters', CENTIMETERS),
    ),
    options: optionsOf(row.options, fail),
    cells: row,
  };
}

const CENTIMETERS =
  'Debe ser un número de centímetros mayor que 0, con punto decimal y hasta un decimal, como 30.5.';

/** A GTIN with its check digit (ADR-0163), `null` when empty. */
function gtinOf(
  text: string,
  fail: (column: string, code: string, message: string) => undefined,
): string | null | undefined {
  if (text === '') return null;
  if (!GTIN_PATTERN.test(text)) {
    return fail('gtin', 'matches', 'Debe tener 8, 12, 13 o 14 dígitos.');
  }
  try {
    return validGtin(text);
  } catch {
    return fail(
      'gtin',
      'gtinCheckDigit',
      'El dígito verificador no corresponde a este código.',
    );
  }
}

/** A weight or a size, `null` when empty. */
function measureOf(
  text: string,
  parse: (text: string) => number | null,
  fail: () => undefined,
): number | null | undefined {
  if (text === '') return null;
  return parse(text) ?? fail();
}

/**
 * The options of the cells that have a value: at most 3, each value of 1 to 50 characters (ADR-0071). A row with an
 * error adds no variant, so its options are only checked.
 */
function optionsOf(
  cells: Readonly<Record<string, string>>,
  fail: (column: string, code: string, message: string) => undefined,
): VariantOptions | undefined {
  const options = Object.fromEntries(
    Object.entries(cells).filter(([, value]) => value !== ''),
  );
  for (const [name, value] of Object.entries(options)) {
    if (value.length > MAX_OPTION_VALUE_LENGTH) {
      fail(
        `${OPTION_COLUMN_PREFIX}${name}`,
        'maxLength',
        `Debe tener hasta ${MAX_OPTION_VALUE_LENGTH} caracteres.`,
      );
    }
  }
  if (Object.keys(options).length > MAX_OPTIONS) {
    return fail('options', 'options', `Tiene más de ${MAX_OPTIONS} opciones.`);
  }
  return options;
}

/**
 * The products of the file, by slug in the order of their first row, which has their data: the title is required,
 * and the next rows leave each product column empty or repeat it.
 */
function productsOf(
  values: readonly RowValues[],
  errors: ProductRowErrors,
): ProductRows[] {
  const products = new Map<string, ProductRows>();
  for (const row of values) {
    if (row.slug === undefined) continue;
    const product = products.get(row.slug);
    if (product === undefined) {
      products.set(row.slug, { slug: row.slug, rows: [row] });
      if (row.cells.title === '') {
        errors.add(row.line, 'title', 'isNotEmpty', REQUIRED);
      }
      continue;
    }
    product.rows.push(row);
    const first = product.rows[0];
    for (const column of PRODUCT_COLUMNS) {
      if (
        row.cells[column] !== '' &&
        !sameCell(column, row.cells, first.cells)
      ) {
        errors.add(
          row.line,
          column,
          'differsFromProduct',
          'Es distinto del de la primera fila del producto: déjalo vacío o repítelo igual.',
        );
      }
    }
  }
  return [...products.values()];
}

/** Two cells of a product column say the same: slugs whatever their case, and categories in any order. */
function sameCell(
  column: (typeof PRODUCT_COLUMNS)[number],
  a: ProductImportRow,
  b: ProductImportRow,
): boolean {
  if (column === 'brand')
    return a.brand.toLowerCase() === b.brand.toLowerCase();
  if (column === 'categories') {
    return (
      categorySlugsFrom(a.categories).sort().join('|') ===
      categorySlugsFrom(b.categories).sort().join('|')
    );
  }
  return a[column] === b[column];
}

/** A SKU or a GTIN used by an earlier row of the file is an error of the later ones. */
function rejectRepeated(
  values: readonly RowValues[],
  errors: ProductRowErrors,
): void {
  const skus = new Set<string>();
  const keys = new Set<string>();
  for (const { line, sku, gtin } of values) {
    if (sku !== undefined) {
      if (skus.has(sku)) {
        errors.add(
          line,
          'sku',
          'repeated',
          'Otra fila del archivo ya tiene este SKU.',
        );
      }
      skus.add(sku);
    }
    if (typeof gtin === 'string') {
      const key = gtinKey(gtin);
      if (keys.has(key)) {
        errors.add(
          line,
          'gtin',
          'repeated',
          'Otra fila del archivo ya tiene este GTIN.',
        );
      }
      keys.add(key);
    }
  }
}

/**
 * The product of some rows, with the variants of the rows without errors, so the rules between variants are
 * checked as `POST …/variants` checks them: the same option names, and a combination per variant (BR-PRD-02).
 * `null` when the data of the product has errors.
 */
function build(
  { slug, rows }: ProductRows,
  brands: ReadonlyMap<string, BrandId>,
  categories: ReadonlyMap<string, CategoryId>,
  errors: ProductRowErrors,
): Product | null {
  const [first] = rows;
  if (
    first.title === undefined ||
    first.title === '' ||
    first.description === undefined ||
    first.categories === undefined
  ) {
    return null;
  }
  const product = Product.create({
    id: newId(),
    title: first.title,
    slug,
    description: first.description,
    brandId: brands.get(first.brand) ?? null,
    categoryIds: first.categories.flatMap((category) => {
      const id = categories.get(category);
      return id === undefined ? [] : [id];
    }),
  });
  for (const row of rows) {
    if (errors.hasAny(row.line)) continue;
    try {
      product.addVariant({
        id: newId(),
        sku: row.sku ?? '',
        gtin: row.gtin ?? null,
        options: row.options ?? {},
        weightGrams: row.weightGrams ?? null,
        lengthCm: row.lengthCm ?? null,
        widthCm: row.widthCm ?? null,
        heightCm: row.heightCm ?? null,
      });
    } catch (error) {
      if (error instanceof OptionNamesMismatchError) {
        errors.add(row.line, 'options', 'optionNames', messageOf(error));
      } else if (
        error instanceof DuplicateValueError &&
        error.details?.field === 'options'
      ) {
        errors.add(
          row.line,
          'options',
          'repeated',
          'Otra variante del producto ya tiene esta combinación de opciones.',
        );
      } else {
        throw error;
      }
    }
  }
  return product;
}

/** The Spanish message of an error of one field. */
function messageOf(error: OptionNamesMismatchError): string {
  const [field] = error.details?.errors as readonly { message: string }[];
  return field.message;
}

/** The first values of a list, and how many more there are. */
function listed(values: readonly string[]): string {
  const shown = values.slice(0, MAX_SLUGS_LISTED).join(', ');
  const more = values.length - MAX_SLUGS_LISTED;
  return more > 0 ? `${shown} y ${more} más` : shown;
}
