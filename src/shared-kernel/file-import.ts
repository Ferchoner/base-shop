import { DomainError } from './domain-error.js';

/** Most row errors an answer lists, the first ones by line (ADR-0126, ADR-0164). */
export const MAX_IMPORT_ERRORS = 100;

/** One error of a row, with its path as `rows[<line>].<column>` (API_SPEC.md §6.1). */
export interface ImportRowError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/**
 * The file of a bulk import has errors, so nothing was imported (ADR-0126, ADR-0164). Answered 400
 * `validation-error` with the first errors by line.
 */
export class FileImportError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';
  /** Always set by the constructor; `declare` narrows the type without redefining the field. */
  declare readonly details: { readonly errors: readonly ImportRowError[] };

  constructor(
    errors: readonly ImportRowError[],
    message = 'The file has errors',
  ) {
    super(message, { errors: errors.slice(0, MAX_IMPORT_ERRORS) });
  }
}

/** The errors of the rows of a file, kept in the order of their lines. */
export class ImportRowErrors {
  private readonly errors: { line: number; error: ImportRowError }[] = [];
  private readonly lines = new Set<number>();

  /** An error of a cell, or of the whole row without `column`. */
  add(line: number, column: string | null, code: string, message: string) {
    const field = column === null ? `rows[${line}]` : `rows[${line}].${column}`;
    this.errors.push({ line, error: { field, code, message } });
    this.lines.add(line);
  }

  /** Whether a row has any error, so the checks that need its other values can skip it. */
  hasAny(line: number): boolean {
    return this.lines.has(line);
  }

  /** @throws FileImportError, or the error of `errorFor`, when there is any error. */
  throwIfAny(): void {
    if (this.errors.length === 0) return;
    throw this.errorFor(
      [...this.errors]
        .sort((a, b) => a.line - b.line)
        .map(({ error }) => error),
    );
  }

  /** The error that answers the errors, sorted by line. */
  protected errorFor(errors: readonly ImportRowError[]): FileImportError {
    return new FileImportError(errors);
  }
}
