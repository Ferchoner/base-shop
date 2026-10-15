import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import { readProductFile } from './product-file.js';

const file = (text: string) => ({ buffer: Buffer.from(text) });

describe('readProductFile (UC-CAT-16, ADR-0164)', () => {
  it('reads each column by name and the options by the name after option:, in lowercase', () => {
    const rows = readProductFile(
      file(
        '﻿SKU,slug,Title,Option:Talla,brand,option:color,categories,description,gtin,weightGrams,lengthCm,widthCm,heightCm\r\n' +
          'cam-m,camisa,"Camisa, de lino",M,marca,Azul,camisas|hombre,"Fresca\r\ny ligera",7501055363063,250,30,20.5,3\r\n' +
          'cam-g,camisa,,G\r\n',
      ),
    );

    expect(rows).toEqual([
      {
        line: 2,
        wellFormed: true,
        slug: 'camisa',
        title: 'Camisa, de lino',
        description: 'Fresca\r\ny ligera',
        brand: 'marca',
        categories: 'camisas|hombre',
        sku: 'cam-m',
        gtin: '7501055363063',
        weightGrams: '250',
        lengthCm: '30',
        widthCm: '20.5',
        heightCm: '3',
        options: { talla: 'M', color: 'Azul' },
      },
      {
        line: 4,
        wellFormed: false,
        slug: 'camisa',
        title: '',
        description: '',
        brand: '',
        categories: '',
        sku: 'cam-g',
        gtin: '',
        weightGrams: '',
        lengthCm: '',
        widthCm: '',
        heightCm: '',
        options: { talla: 'G', color: '' },
      },
    ]);
  });

  it('takes only the required columns', () => {
    expect(readProductFile(file('slug,title,sku\ngorra,Gorra,G-1\n'))).toEqual([
      expect.objectContaining({ slug: 'gorra', options: {}, gtin: '' }),
    ]);
  });

  it.each([
    ['without a required column', 'slug,sku\na,b\n', 'columns'],
    ['with an unknown column', 'slug,title,sku,precio\na,b,c,1\n', 'columns'],
    ['without rows', 'slug,title,sku\n', 'emptyFile'],
  ])('answers 400 on file %s', (_, text, code) => {
    expect(() => readProductFile(file(text))).toThrow(
      expect.objectContaining({
        code: 'validation-error',
        extensions: {
          errors: [expect.objectContaining({ field: 'file', code })],
        },
      }),
    );
  });

  it('takes the name of an option of up to 30 characters, and answers columns for a longer one', () => {
    const header = (name: string) => `slug,title,sku,option:${name}\na,b,c,d\n`;

    expect(readProductFile(file(header('a'.repeat(30))))[0].options).toEqual({
      ['a'.repeat(30)]: 'd',
    });
    let thrown: unknown;
    try {
      readProductFile(file(header('a'.repeat(31))));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProblemException);
    expect(thrown).toMatchObject({
      extensions: {
        errors: [
          {
            field: 'file',
            code: 'columns',
            message: `El nombre de la opción ${'a'.repeat(31)} debe tener hasta 30 caracteres.`,
          },
        ],
      },
    });
  });
});
