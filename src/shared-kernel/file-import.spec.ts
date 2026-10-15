import {
  FileImportError,
  type ImportRowError,
  ImportRowErrors,
  MAX_IMPORT_ERRORS,
} from './file-import.js';

function thrownBy(act: () => void): unknown {
  try {
    act();
  } catch (error) {
    return error;
  }
  throw new Error('Nothing was thrown');
}

describe('ImportRowErrors (ADR-0126, ADR-0164)', () => {
  it('answers the errors of the cells and of the rows sorted by line, as a validation-error', () => {
    const errors = new ImportRowErrors();
    errors.add(7, 'sku', 'taken', 'Ya existe.');
    errors.add(3, null, 'columnCount', 'Tiene otro número de valores.');
    errors.add(3, 'title', 'isNotEmpty', 'Es obligatorio.');

    const error = thrownBy(() => errors.throwIfAny());

    expect(error).toBeInstanceOf(FileImportError);
    expect(error).toMatchObject({
      code: 'validation-error',
      category: 'invalid',
      message: 'The file has errors',
      details: {
        errors: [
          {
            field: 'rows[3]',
            code: 'columnCount',
            message: 'Tiene otro número de valores.',
          },
          {
            field: 'rows[3].title',
            code: 'isNotEmpty',
            message: 'Es obligatorio.',
          },
          { field: 'rows[7].sku', code: 'taken', message: 'Ya existe.' },
        ],
      },
    });
  });

  it('throws nothing without errors', () => {
    expect(() => new ImportRowErrors().throwIfAny()).not.toThrow();
  });

  it('says which rows have errors', () => {
    const errors = new ImportRowErrors();
    errors.add(4, 'sku', 'matches', 'No es un SKU.');

    expect([errors.hasAny(4), errors.hasAny(5)]).toEqual([true, false]);
  });

  it(`answers only the first ${MAX_IMPORT_ERRORS} errors`, () => {
    const errors = new ImportRowErrors();
    for (let line = MAX_IMPORT_ERRORS + 11; line > 1; line -= 1) {
      errors.add(line, 'sku', 'isNotEmpty', 'Es obligatorio.');
    }

    const { details } = thrownBy(() => errors.throwIfAny()) as FileImportError;
    const answered = details?.errors as ImportRowError[];

    expect(answered).toHaveLength(MAX_IMPORT_ERRORS);
    expect(answered[0].field).toBe('rows[2].sku');
    expect(answered.at(-1)?.field).toBe(`rows[${MAX_IMPORT_ERRORS + 1}].sku`);
  });

  it('answers the error of a subclass', () => {
    class ProductFileError extends FileImportError {}
    class ProductRowErrors extends ImportRowErrors {
      protected override errorFor(
        rowErrors: readonly ImportRowError[],
      ): FileImportError {
        return new ProductFileError(rowErrors, 'The product file has errors');
      }
    }
    const errors = new ProductRowErrors();
    errors.add(2, 'slug', 'taken', 'Ya existe.');

    const error = thrownBy(() => errors.throwIfAny());

    expect(error).toBeInstanceOf(ProductFileError);
    expect(error).toMatchObject({ message: 'The product file has errors' });
  });
});
