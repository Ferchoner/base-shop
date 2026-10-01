import { MAX_MONEY_AMOUNT } from '../../../shared-kernel/index.js';
import {
  centsFromPesos,
  instantFrom,
  MAX_PRICE_IMPORT_ERRORS,
  PriceImportError,
  PriceRowErrors,
} from './price-import.js';

/** What `work` throws; fails the test when it throws nothing. */
function thrownBy(work: () => void): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('Nothing was thrown');
}

describe('Bulk import values (UC-PRC-05, ADR-0126)', () => {
  describe('centsFromPesos', () => {
    it.each([
      ['599', 59_900],
      ['599.5', 59_950],
      ['599.00', 59_900],
      ['0', 0],
      ['0.01', 1],
      ['21474836.47', MAX_MONEY_AMOUNT],
    ])('reads %s as %d cents', (text, cents) => {
      expect(centsFromPesos(text)).toBe(cents);
    });

    it.each([
      '$599',
      '1,599.00',
      '599,00',
      '599.001',
      '-1',
      '.5',
      '599.',
      ' 599',
      '1e3',
      '21474836.48',
      '',
    ])('rejects %j', (text) => {
      expect(centsFromPesos(text)).toBeNull();
    });
  });

  describe('instantFrom', () => {
    it.each([
      // Mexico's time, without an offset: UTC-6 since 2022.
      ['2026-11-14 00:00', '2026-11-14T06:00:00.000Z'],
      ['2026-11-14T23:59:30', '2026-11-15T05:59:30.000Z'],
      // Summer time, which Mexico had until October 2022: UTC-5.
      ['2022-07-01 12:00', '2022-07-01T17:00:00.000Z'],
      ['2022-12-01 12:00', '2022-12-01T18:00:00.000Z'],
      // Just after the clocks jumped from 2:00 to 3:00 on 2022-04-03: already summer time.
      ['2022-04-03 03:30', '2022-04-03T08:30:00.000Z'],
      // ISO 8601 with an offset, as the API takes it.
      ['2026-11-14T06:00:00Z', '2026-11-14T06:00:00.000Z'],
      ['2026-11-14T00:00:00.250-06:00', '2026-11-14T06:00:00.250Z'],
      ['2026-11-14T00:00+00:00', '2026-11-14T00:00:00.000Z'],
    ])('reads %s as %s', (text, iso) => {
      expect(instantFrom(text)?.toISOString()).toBe(iso);
    });

    it.each([
      '2026-02-30 00:00',
      '2026-02-30T00:00:00Z',
      '2026-11-14 24:00',
      '2026-11-14 12:60',
      '2026-11-14T12:00:61Z',
      '2026-13-01T00:00:00Z',
      '2026-11-14',
      '14/11/2026 00:00',
      '2026-11-14 0:00',
      '2026-11-14T00:00:00+0600',
      'mañana',
    ])('rejects %j', (text) => {
      expect(instantFrom(text)).toBeNull();
    });
  });

  describe('PriceRowErrors', () => {
    it('lists the errors by line, with their path, and nothing when there is none', () => {
      const errors = new PriceRowErrors();
      expect(() => errors.throwIfAny()).not.toThrow();

      errors.add(7, 'sku', 'unknownSku', 'No existe.');
      errors.add(3, null, 'columnCount', 'Faltan valores.');
      errors.add(3, 'amount', 'pesos', 'No es un monto.');

      const error = thrownBy(() => errors.throwIfAny());

      expect(error).toBeInstanceOf(PriceImportError);
      expect(error).toMatchObject({
        code: 'validation-error',
        category: 'invalid',
        details: {
          errors: [
            {
              field: 'rows[3]',
              code: 'columnCount',
              message: 'Faltan valores.',
            },
            {
              field: 'rows[3].amount',
              code: 'pesos',
              message: 'No es un monto.',
            },
            {
              field: 'rows[7].sku',
              code: 'unknownSku',
              message: 'No existe.',
            },
          ],
        },
      });
    });

    it(`answers only the first ${MAX_PRICE_IMPORT_ERRORS} errors`, () => {
      const errors = new PriceRowErrors();
      for (let line = MAX_PRICE_IMPORT_ERRORS + 11; line > 1; line -= 1) {
        errors.add(line, 'sku', 'isNotEmpty', 'Es obligatorio.');
      }

      const answered = (thrownBy(() => errors.throwIfAny()) as PriceImportError)
        .details?.errors;

      expect(answered).toHaveLength(MAX_PRICE_IMPORT_ERRORS);
      expect((answered as { field: string }[])[0].field).toBe('rows[2].sku');
    });
  });
});
