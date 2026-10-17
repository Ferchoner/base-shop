import { DomainError } from '../../../shared-kernel/index.js';

/** An error of one field, with its code and its Spanish message, as the API answers a validation error. */
export interface PromotionFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/**
 * The end of a promotion is not after its start (`afterStart`), or, once it started, not after now (`inFuture`):
 * it would end before it begins, or in the past (ADR-0168).
 */
export class PromotionEndError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';
  /** Always set by the constructor; `declare` narrows the type without redefining the field. */
  declare readonly details: { readonly errors: readonly [PromotionFieldError] };

  constructor(code: 'afterStart' | 'inFuture') {
    super(`endsAt: ${code}`, {
      errors: [
        {
          field: 'endsAt',
          code,
          message:
            code === 'afterStart'
              ? 'Debe ser posterior al inicio.'
              : 'Debe ser posterior al momento actual.',
        },
      ],
    });
  }
}

/**
 * Products, categories or brands a promotion cannot target (ADR-0168): one that does not exist (`unknownTarget`), or
 * that is not in use, an archived product or an inactive category or brand (`unusableTarget`). Each error names the
 * target by its place in `targets`.
 */
export class UnusableTargetsError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';
  declare readonly details: { readonly errors: readonly PromotionFieldError[] };

  constructor(
    problems: readonly {
      readonly index: number;
      readonly problem: 'unknown' | 'unusable';
    }[],
  ) {
    super('Some targets cannot be used', {
      errors: problems.map(({ index, problem }) => ({
        field: `targets[${index}].id`,
        code: problem === 'unknown' ? 'unknownTarget' : 'unusableTarget',
        message:
          problem === 'unknown'
            ? 'No existe.'
            : 'No está en uso: es un producto archivado, o una categoría o marca inactiva.',
      })),
    });
  }
}
