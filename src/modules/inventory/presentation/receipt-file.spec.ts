import { createHash } from 'node:crypto';
import { readReceiptFile } from './receipt-file.js';

const file = (text: string) => ({ buffer: Buffer.from(text) });

describe('readReceiptFile (UC-INV-12, ADR-0164)', () => {
  it('reads each column by name, and the SHA-256 of the bytes of the file', () => {
    const text =
      '﻿Quantity,SKU,warehouse,Note\r\n25, cam-lino-m ,principal,"Remisión 1234, caja 2"\r\n3,GORRA\r\n';

    expect(readReceiptFile(file(text))).toEqual({
      sha256: createHash('sha256').update(Buffer.from(text)).digest('hex'),
      rows: [
        {
          line: 2,
          wellFormed: true,
          sku: 'cam-lino-m',
          warehouse: 'principal',
          quantity: '25',
          note: 'Remisión 1234, caja 2',
        },
        {
          line: 3,
          wellFormed: false,
          sku: 'GORRA',
          warehouse: '',
          quantity: '3',
          note: '',
        },
      ],
    });
  });

  it('takes a file without notes, and tells two files apart by their bytes', () => {
    const one = readReceiptFile(file('sku,warehouse,quantity\nA,B,1\n'));
    const other = readReceiptFile(file('sku,warehouse,quantity\r\nA,B,1\r\n'));

    expect(one.rows[0].note).toBe('');
    expect(one.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(one.sha256).not.toBe(other.sha256);
  });

  it.each([
    ['without a required column', 'sku,quantity\nA,1\n', 'columns'],
    [
      'with an unknown column',
      'sku,warehouse,quantity,cost\nA,B,1,9\n',
      'columns',
    ],
    ['without rows', 'sku,warehouse,quantity\n', 'emptyFile'],
  ])('answers 400 on file %s', (_, text, code) => {
    expect(() => readReceiptFile(file(text))).toThrow(
      expect.objectContaining({
        code: 'validation-error',
        extensions: {
          errors: [expect.objectContaining({ field: 'file', code })],
        },
      }),
    );
  });

  it('answers isDefined without a file', () => {
    expect(() => readReceiptFile(undefined)).toThrow(
      expect.objectContaining({
        extensions: {
          errors: [
            expect.objectContaining({ field: 'file', code: 'isDefined' }),
          ],
        },
      }),
    );
  });
});
