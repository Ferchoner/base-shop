import { DomainError } from '../../../shared-kernel/index.js';

/**
 * Fields that are fixed after the first publication (E-32, ADR-0068): the slug of the product, and the SKU and
 * options of its variants. Answered 409 `field-locked` with the `fields` that cannot change.
 */
export class FieldLockedError extends DomainError {
  readonly code = 'field-locked';
  readonly category = 'conflict';

  constructor(fields: readonly string[]) {
    super(`Fixed after the first publication: ${fields.join(', ')}`, {
      fields,
    });
  }
}

/**
 * A product is published only with at least one active variant (BR-PRD-04). Answered 409
 * `invalid-state-transition` with `reason`, since `detail` is fixed by problem type (ADR-0095, ADR-0123).
 */
export class NoActiveVariantError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly category = 'conflict';

  constructor() {
    super('A product needs an active variant to be published', {
      currentStatus: 'DRAFT',
      reason: 'no-active-variant',
    });
  }
}

/** A value the API answers as a validation error of one field, with a code and a Spanish message. */
abstract class FieldError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  protected constructor(field: string, code: string, message: string) {
    super(`${field}: ${code}`, { errors: [{ field, code, message }] });
  }
}

/** The options of a variant break the rules of ADR-0071 (API_SPEC.md §11.7). */
export class InvalidOptionsError extends FieldError {
  constructor(message: string) {
    super('options', 'options', message);
  }
}

/**
 * Every variant of a product has the same option names (API_SPEC.md §11.7). After the first publication, a
 * new name is a new dimension and answers `field-locked` instead (ADR-0068).
 */
export class OptionNamesMismatchError extends FieldError {
  constructor(expected: readonly string[]) {
    super(
      'options',
      'optionNames',
      expected.length === 0
        ? 'Las demás variantes del producto no tienen opciones.'
        : `Debe tener las mismas opciones que las demás variantes del producto: ${expected.join(', ')}.`,
    );
  }
}

/** A brand given to a product does not exist or is inactive (API_SPEC.md §11.6). */
export class UnusableBrandError extends FieldError {
  constructor(problem: 'unknown' | 'inactive') {
    super(
      'brandId',
      problem === 'unknown' ? 'unknownBrand' : 'inactiveBrand',
      problem === 'unknown' ? 'La marca no existe.' : 'La marca está inactiva.',
    );
  }
}

/** A category given to a product does not exist or is inactive (API_SPEC.md §11.6). */
export class UnusableCategoriesError extends FieldError {
  constructor(problem: 'unknown' | 'inactive') {
    super(
      'categoryIds',
      problem === 'unknown' ? 'unknownCategories' : 'inactiveCategories',
      problem === 'unknown'
        ? 'Una o más categorías no existen.'
        : 'Una o más categorías están inactivas.',
    );
  }
}

/**
 * The store listing is filtered by a category that does not exist or is hidden (ADR-0080). The store answers
 * both the same way, so it never tells what the staff hid (ADR-0129).
 */
export class UnknownCategoryFilterError extends FieldError {
  constructor() {
    super('category', 'unknownCategory', 'La categoría no existe.');
  }
}

/** The store listing is filtered by a brand that does not exist or is inactive (ADR-0080, ADR-0129). */
export class UnknownBrandsFilterError extends FieldError {
  constructor() {
    super('brand', 'unknownBrands', 'Una o más marcas no existen.');
  }
}
