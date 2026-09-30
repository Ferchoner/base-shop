import { type Id, InvalidValueError } from '../../../shared-kernel/index.js';
import { InvalidOptionsError } from './product-errors.js';

export type VariantId = Id<'Variant'>;

export type VariantStatus = 'ACTIVE' | 'DISCONTINUED';

export const VARIANT_STATUSES: readonly VariantStatus[] = [
  'ACTIVE',
  'DISCONTINUED',
];

/** Option name → value, such as `{ talla: 'M', color: 'Azul' }`; `{}` for a variant without options. */
export type VariantOptions = Readonly<Record<string, string>>;

/** Limits of ADR-0071 (API_SPEC.md §11.7). */
export const MAX_OPTIONS = 3;
export const MAX_OPTION_NAME_LENGTH = 30;
export const MAX_OPTION_VALUE_LENGTH = 50;

/** 1 to 64 letters, digits, `-`, `_` and `.`; stored in uppercase (BR-PRD-01). */
export const SKU_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Limits of the columns: `integer` grams and `numeric(7,1)` centimeters (DATABASE.md §4.5). */
export const MAX_WEIGHT_GRAMS = 2_147_483_647;
export const MAX_DIMENSION_CM = 999_999.9;

/** Optional weight and size of a variant (BR-PRD-14, ADR-0058). */
export interface VariantDimensions {
  readonly weightGrams: number | null;
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
  readonly heightCm: number | null;
}

export interface VariantSnapshot extends VariantDimensions {
  readonly id: VariantId;
  readonly sku: string;
  readonly options: VariantOptions;
  readonly status: VariantStatus;
}

/** The SKU in uppercase, as it is stored and compared (BR-PRD-01, BR-PRD-09). */
export function validSku(sku: string): string {
  if (!SKU_PATTERN.test(sku)) {
    throw new InvalidValueError(
      'A SKU has 1 to 64 letters, digits, "-", "_" and "."',
    );
  }
  return sku.toUpperCase();
}

/**
 * The options with their names trimmed and in lowercase, and their values trimmed (ADR-0123): `Talla` and
 * `talla` are the same option, while `Azul` stays as the staff wrote it.
 */
export function validOptions(
  options: Readonly<Record<string, unknown>>,
): VariantOptions {
  const entries = Object.entries(options);
  if (entries.length > MAX_OPTIONS) {
    throw new InvalidOptionsError(`Tiene más de ${MAX_OPTIONS} opciones.`);
  }
  const valid: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();
    if (name.length === 0 || name.length > MAX_OPTION_NAME_LENGTH) {
      throw new InvalidOptionsError(
        `Cada nombre de opción tiene de 1 a ${MAX_OPTION_NAME_LENGTH} caracteres.`,
      );
    }
    if (name in valid) {
      throw new InvalidOptionsError(`La opción ${name} está repetida.`);
    }
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (value.length === 0 || value.length > MAX_OPTION_VALUE_LENGTH) {
      throw new InvalidOptionsError(
        `Cada valor de opción es texto de 1 a ${MAX_OPTION_VALUE_LENGTH} caracteres.`,
      );
    }
    valid[name] = value;
  }
  return valid;
}

/** The option names, sorted, to compare the dimensions of two variants. */
export function optionNamesOf(options: VariantOptions): string[] {
  return Object.keys(options).sort();
}

/** Two combinations are the same when they have the same names with the same values (BR-PRD-02). */
export function sameOptions(a: VariantOptions, b: VariantOptions): boolean {
  const names = optionNamesOf(a);
  return (
    names.join('\u0000') === optionNamesOf(b).join('\u0000') &&
    names.every((name) => a[name] === b[name])
  );
}

/** Positive weight in whole grams and sizes in centimeters with one decimal, all optional (ADR-0058). */
export function validDimensions(
  dimensions: VariantDimensions,
): VariantDimensions {
  const { weightGrams, lengthCm, widthCm, heightCm } = dimensions;
  if (
    weightGrams !== null &&
    (!Number.isInteger(weightGrams) ||
      weightGrams < 1 ||
      weightGrams > MAX_WEIGHT_GRAMS)
  ) {
    throw new InvalidValueError('A weight is a whole number of grams above 0');
  }
  for (const size of [lengthCm, widthCm, heightCm]) {
    if (size === null) continue;
    const tenths = size * 10;
    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      size > MAX_DIMENSION_CM ||
      // Floating point: 30.1 × 10 is 301.00000000000006.
      Math.abs(tenths - Math.round(tenths)) > 1e-6
    ) {
      throw new InvalidValueError(
        'A size is a number of centimeters above 0 with at most one decimal',
      );
    }
  }
  return { weightGrams, lengthCm, widthCm, heightCm };
}
