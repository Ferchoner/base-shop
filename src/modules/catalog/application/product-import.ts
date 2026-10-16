import {
  FileImportError,
  type ImportRowError,
  ImportRowErrors,
} from '../../../shared-kernel/index.js';
import { MAX_OPTION_NAME_LENGTH, MAX_WEIGHT_GRAMS } from '../domain/variant.js';

/** Most rows a bulk import of products takes, one per variant (ADR-0164). */
export const MAX_PRODUCT_IMPORT_ROWS = 5_000;

/** Largest file a bulk import of products takes: 5 MB, for the descriptions (ADR-0164). */
export const MAX_PRODUCT_FILE_BYTES = 5_242_880;

/** Columns the file must have, in any order (ADR-0164). */
export const REQUIRED_PRODUCT_COLUMNS = ['slug', 'title', 'sku'] as const;

/** Columns the file may have, in any order (ADR-0164). */
export const OPTIONAL_PRODUCT_COLUMNS = [
  'description',
  'brand',
  'categories',
  'gtin',
  'weightGrams',
  'lengthCm',
  'widthCm',
  'heightCm',
  'storeOnly',
] as const;

/** Prefix of the column of each option, such as `option:talla` (ADR-0164). */
export const OPTION_COLUMN_PREFIX = 'option:';

/** Longest name of an option, and so of what follows the prefix of its column (ADR-0071). */
export const MAX_OPTION_COLUMN_NAME_LENGTH = MAX_OPTION_NAME_LENGTH;

/** Separator of the slugs of the `categories` column. */
export const CATEGORY_SEPARATOR = '|';

/** A row of the file as read, one per variant, with its line in the file (the header is line 1) and its cells trimmed. */
export interface ProductImportRow {
  readonly line: number;
  /** False when the row has another number of cells than the header. */
  readonly wellFormed: boolean;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly brand: string;
  readonly categories: string;
  readonly sku: string;
  readonly gtin: string;
  readonly weightGrams: string;
  readonly lengthCm: string;
  readonly widthCm: string;
  readonly heightCm: string;
  /** `true` or `false`, whatever its case: sold only in the physical store (ADR-0165); '' is `false`. */
  readonly storeOnly: string;
  /** The cell of each option column, by the name of the option in lowercase; '' when the variant has not it. */
  readonly options: Readonly<Record<string, string>>;
}

/** What an import did, or would do with `dryRun`. */
export interface ProductImportSummary {
  readonly rows: number;
  /** Products created, in DRAFT. */
  readonly products: number;
  /** Variants created, one per row. */
  readonly variants: number;
  readonly dryRun: boolean;
}

/**
 * The product file has errors, so nothing was imported (ADR-0164). Answered 400 `validation-error` with the first
 * errors by line.
 */
export class ProductImportError extends FileImportError {
  constructor(errors: readonly ImportRowError[]) {
    super(errors, 'The product file has errors');
  }
}

/** The errors of the rows of a product file, kept in the order of their lines. */
export class ProductRowErrors extends ImportRowErrors {
  /** @returns ProductImportError. */
  protected override errorFor(
    errors: readonly ImportRowError[],
  ): ProductImportError {
    return new ProductImportError(errors);
  }
}

const GRAMS = /^\d{1,10}$/;
/** Up to 999,999.9, the largest size (`numeric(7,1)`). */
const CENTIMETERS = /^\d{1,6}(\.\d)?$/;

/** The whole grams of a weight above 0, such as `250`; `null` for anything else, such as `250.5` or `0`. */
export function gramsFrom(text: string): number | null {
  if (!GRAMS.test(text)) return null;
  const grams = Number(text);
  return grams >= 1 && grams <= MAX_WEIGHT_GRAMS ? grams : null;
}

/**
 * The centimeters of a size above 0 with a decimal point and up to 1 decimal, such as `30` or `30.5`; `null` for
 * anything else, such as `30,5`, `30.25` or `0`.
 */
export function centimetersFrom(text: string): number | null {
  if (!CENTIMETERS.test(text)) return null;
  const centimeters = Number(text);
  return centimeters > 0 ? centimeters : null;
}

/** The slugs of the `categories` column: separated by `|`, trimmed, in lowercase and without repeats or blanks. */
export function categorySlugsFrom(text: string): string[] {
  return [
    ...new Set(
      text
        .split(CATEGORY_SEPARATOR)
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug) => slug !== ''),
    ),
  ];
}
