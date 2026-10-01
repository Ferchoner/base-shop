import { PayloadTooLargeException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import {
  MAX_PRICE_FILE_BYTES,
  MAX_PRICE_IMPORT_ROWS,
} from '../application/price-import.js';
import { PriceFileLimit, readPriceFile } from './price-file.js';

const file = (text: string | Uint8Array) => ({
  buffer: Buffer.from(typeof text === 'string' ? text : text),
});

/** The extensions of the 400 that reading `content` answers; fails when it reads the file. */
function fileErrorOf(content: string | Uint8Array | undefined): unknown {
  let thrown: unknown;
  try {
    readPriceFile(content === undefined ? undefined : file(content));
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof ProblemException)) {
    throw new Error('The file was read, or failed another way');
  }
  return { code: thrown.code, ...thrown.extensions };
}

describe('readPriceFile (UC-PRC-05, ADR-0126)', () => {
  it('reads each row with its line and its cells trimmed, whatever the order and case of the columns', () => {
    const rows = readPriceFile(
      file(
        '﻿EffectiveFrom, SKU ,amount,compareAtAmount\r\n' +
          '\r\n' +
          ',cam-lino-m , 599.00,799\r\n' +
          '"2026-11-14 00:00",GORRA,199,\r\n' +
          'PLAYERA,99\r\n',
      ),
    );

    expect(rows).toEqual([
      {
        line: 3,
        wellFormed: true,
        sku: 'cam-lino-m',
        amount: '599.00',
        compareAtAmount: '799',
        effectiveFrom: '',
      },
      {
        line: 4,
        wellFormed: true,
        sku: 'GORRA',
        amount: '199',
        compareAtAmount: '',
        effectiveFrom: '2026-11-14 00:00',
      },
      {
        line: 5,
        wellFormed: false,
        sku: '99',
        amount: '',
        compareAtAmount: '',
        effectiveFrom: 'PLAYERA',
      },
    ]);
  });

  it.each([
    ['no file', undefined, 'isDefined'],
    ['an empty file', '', 'emptyFile'],
    [
      'only the header',
      'sku,amount,compareAtAmount,effectiveFrom\n',
      'emptyFile',
    ],
    ['a missing column', 'sku,amount,effectiveFrom\nA,1,\n', 'columns'],
    [
      'an extra column',
      'sku,amount,compareAtAmount,effectiveFrom,note\nA,1,,,x\n',
      'columns',
    ],
    [
      'a repeated column',
      'sku,amount,amount,effectiveFrom\nA,1,1,\n',
      'columns',
    ],
    [
      'a quote left open',
      'sku,amount,compareAtAmount,effectiveFrom\n"A,1,,\n',
      'csv',
    ],
    // "Camisa México" in Latin-1: é is the single byte 0xE9, invalid in UTF-8.
    [
      'another encoding',
      Uint8Array.from([
        ...Buffer.from('sku,amount,compareAtAmount,effectiveFrom\nM'),
        0xe9,
        ...Buffer.from('X,1,,\n'),
      ]),
      'utf8',
    ],
  ])('answers 400 on file for %s', (_, content, code) => {
    expect(fileErrorOf(content)).toEqual({
      code: 'validation-error',
      errors: [expect.objectContaining({ field: 'file', code })],
    });
  });

  it(`takes up to ${MAX_PRICE_IMPORT_ROWS} rows`, () => {
    const rows = (count: number) =>
      `sku,amount,compareAtAmount,effectiveFrom\n${'A,1,,\n'.repeat(count)}`;

    expect(readPriceFile(file(rows(MAX_PRICE_IMPORT_ROWS)))).toHaveLength(
      MAX_PRICE_IMPORT_ROWS,
    );
    expect(fileErrorOf(rows(MAX_PRICE_IMPORT_ROWS + 1))).toEqual({
      code: 'validation-error',
      errors: [
        expect.objectContaining({
          field: 'file',
          code: 'tooManyRows',
          message: 'Tiene más de 5,000 filas.',
        }),
      ],
    });
  });
});

describe('PriceFileLimit', () => {
  const failing = (error: unknown) => ({
    handle: () => throwError(() => error),
  });

  it('answers the 413 of multer with maxBytes', async () => {
    const answered = lastValueFrom(
      new PriceFileLimit().intercept(
        {} as never,
        failing(new PayloadTooLargeException()),
      ),
    );

    await expect(answered).rejects.toMatchObject({
      code: 'payload-too-large',
      extensions: { maxBytes: MAX_PRICE_FILE_BYTES },
    });
  });

  it('lets any other error through', async () => {
    const other = new Error('The disk is full');

    await expect(
      lastValueFrom(
        new PriceFileLimit().intercept({} as never, failing(other)),
      ),
    ).rejects.toBe(other);
  });
});
