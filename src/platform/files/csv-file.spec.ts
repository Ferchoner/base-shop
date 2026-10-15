import { ProblemException } from '../http/problem-details/problem.exception.js';
import { type CsvFileSpec, readCsvFile } from './csv-file.js';

const SPEC: CsvFileSpec = {
  required: ['slug', 'sku'],
  optional: ['weightGrams', 'gtin'],
  prefix: 'option:',
  maxRows: 3,
  noRows: 'No tiene filas de productos.',
};

const file = (text: string) => ({ buffer: Buffer.from(text) });

/** The first error of the 400 that reading `text` answers; fails when it reads the file. */
function fileErrorOf(text: string, spec = SPEC): unknown {
  let thrown: unknown;
  try {
    readCsvFile(file(text), spec);
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof ProblemException)) {
    throw new Error('The file was read, or failed another way');
  }
  const { errors } = thrown.extensions as { errors: unknown[] };
  expect(thrown.code).toBe('validation-error');
  expect(errors).toHaveLength(1);
  return errors[0];
}

describe('readCsvFile (ADR-0126, ADR-0164)', () => {
  it('reads the optional and prefixed columns by name, whatever their order, case and spaces', () => {
    const read = readCsvFile(
      file(
        ' Option:Talla ,SKU,slug,WEIGHTGRAMS,option: Color\n' +
          ' M ,cam-m,camisa, 250 ,Azul\n' +
          'G,cam-g\n',
      ),
      SPEC,
    );

    expect(read).toEqual({
      prefixed: ['talla', 'color'],
      rows: [
        {
          line: 2,
          wellFormed: true,
          cells: { slug: 'camisa', sku: 'cam-m', weightGrams: '250', gtin: '' },
          prefixed: { talla: 'M', color: 'Azul' },
        },
        {
          line: 3,
          wellFormed: false,
          cells: { slug: '', sku: 'cam-g', weightGrams: '', gtin: '' },
          prefixed: { talla: 'G', color: '' },
        },
      ],
    });
  });

  it('takes a prefixed column named like another column', () => {
    expect(
      readCsvFile(file('slug,sku,option:sku\na,b,c\n'), SPEC).rows[0],
    ).toMatchObject({ cells: { slug: 'a', sku: 'b' }, prefixed: { sku: 'c' } });
  });

  it('takes a file without optional or prefixed columns', () => {
    expect(readCsvFile(file('sku,slug\nA,b\n'), SPEC).rows[0].cells).toEqual({
      slug: 'b',
      sku: 'A',
      weightGrams: '',
      gtin: '',
    });
  });

  it.each([
    ['a missing column', 'slug\na\n', 'Le falta la columna sku.'],
    [
      'an unknown column',
      'slug,sku,tittle\na,b,c\n',
      'No reconoce la columna tittle.',
    ],
    [
      'a column without a name',
      'slug,sku,\na,b,c\n',
      'Tiene una columna sin nombre.',
    ],
    ['a repeated column', 'slug,sku,SKU\na,b,c\n', 'Repite la columna SKU.'],
    [
      'a repeated optional column',
      'slug,sku,gtin,Gtin\na,b,,\n',
      'Repite la columna Gtin.',
    ],
    [
      'a prefixed column repeated in another case',
      'slug,sku,option:Talla,option:talla \na,b,M,M\n',
      'Repite la columna option:talla.',
    ],
    [
      'a prefixed column without a name',
      'slug,sku,option: \na,b,M\n',
      'La columna option: no tiene nombre.',
    ],
  ])('answers columns for %s, saying which', (_, text, problem) => {
    expect(fileErrorOf(text)).toEqual({
      field: 'file',
      code: 'columns',
      message:
        'Debe tener una vez cada columna: slug, sku. Puede tener también, una vez cada una: weightGrams, gtin, option:<nombre>. ' +
        problem,
    });
  });

  it('lists only the required columns of a file that has no others', () => {
    expect(
      fileErrorOf('sku,amount,note\nA,1,x\n', {
        required: ['sku', 'amount'],
        maxRows: 3,
        noRows: 'No tiene filas.',
      }),
    ).toEqual({
      field: 'file',
      code: 'columns',
      message:
        'Debe tener una vez cada columna: sku, amount. No reconoce la columna note.',
    });
  });

  it('takes a column named like the prefix only with a prefix in the spec', () => {
    expect(
      fileErrorOf('sku,option:talla\nA,M\n', {
        required: ['sku'],
        maxRows: 3,
        noRows: 'No tiene filas.',
      }),
    ).toMatchObject({ code: 'columns' });
  });

  it.each([
    ['an empty file', ''],
    ['only the header', 'slug,sku\n'],
  ])('answers emptyFile with the message of the spec for %s', (_, text) => {
    expect(fileErrorOf(text)).toEqual({
      field: 'file',
      code: 'emptyFile',
      message: 'No tiene filas de productos.',
    });
  });

  it('takes up to maxRows rows', () => {
    const rows = (count: number) => `slug,sku\n${'a,b\n'.repeat(count)}`;

    expect(readCsvFile(file(rows(3)), SPEC).rows).toHaveLength(3);
    expect(fileErrorOf(rows(4))).toEqual({
      field: 'file',
      code: 'tooManyRows',
      message: 'Tiene más de 3 filas.',
    });
  });

  it.each([
    ['no file', undefined, 'isDefined'],
    ['a quote left open', file('slug,sku\n"a,b\n'), 'csv'],
    ['another encoding', { buffer: Buffer.from([0x73, 0xe9, 0x0a]) }, 'utf8'],
  ])('answers %s on file', (_, upload, code) => {
    let thrown: unknown;
    try {
      readCsvFile(upload, SPEC);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'validation-error',
      extensions: {
        errors: [expect.objectContaining({ field: 'file', code })],
      },
    });
  });
});
