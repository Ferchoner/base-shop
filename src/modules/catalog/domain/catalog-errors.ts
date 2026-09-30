import { DomainError } from '../../../shared-kernel/index.js';

/**
 * Moving a category under itself or under one of its subcategories would create a cycle (BR-PRD-03). Answered
 * 409 `invalid-state-transition`; `reason` tells it apart from other conflicts, since `detail` is fixed by
 * problem type (ADR-0095, ADR-0120).
 */
export class CategoryCycleError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly category = 'conflict';

  constructor() {
    super('A category cannot move under itself or its subcategories', {
      reason: 'category-cycle',
    });
  }
}

/** An inactive category is reactivated only under an active parent or as a root (BR-PRD-13, ADR-0076). */
export class InactiveParentError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly category = 'conflict';

  constructor() {
    super('The parent category is inactive', {
      currentStatus: 'INACTIVE',
      reason: 'inactive-parent',
    });
  }
}

/** Why a category cannot be the parent of another one. */
export type ParentProblem = 'unknown' | 'inactive';

const PARENT_ERRORS: Record<ParentProblem, { code: string; message: string }> =
  {
    unknown: {
      code: 'unknownParent',
      message: 'La categoría padre no existe.',
    },
    inactive: {
      code: 'inactiveParent',
      message: 'La categoría padre está inactiva.',
    },
  };

/**
 * The parent of a new or moved category must exist and be active (API_SPEC.md §11.9). Answered as a
 * validation error of `parentId`, like an unknown role of a staff member (ADR-0112).
 */
export class UnusableParentError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(readonly problem: ParentProblem) {
    super(`The parent category is ${problem}`, {
      errors: [{ field: 'parentId', ...PARENT_ERRORS[problem] }],
    });
  }
}

/**
 * The name has no letter or digit to build a slug from, such as "¡!", and no slug was given (ADR-0120).
 * Answered as a validation error of `slug`, so the staff chooses one.
 */
export class SlugRequiredError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor() {
    super('The name gives no slug', {
      errors: [
        {
          field: 'slug',
          code: 'slugRequired',
          message:
            'El nombre no tiene letras ni dígitos para formar el slug; indica uno.',
        },
      ],
    });
  }
}
