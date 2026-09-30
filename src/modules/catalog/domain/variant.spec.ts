import { InvalidValueError } from '../../../shared-kernel/index.js';
import { InvalidOptionsError } from './product-errors.js';
import {
  MAX_DIMENSION_CM,
  MAX_WEIGHT_GRAMS,
  optionNamesOf,
  sameOptions,
  validDimensions,
  validOptions,
  validSku,
} from './variant.js';

const NO_SIZE = {
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
};

describe('Variant values (BR-PRD-01, BR-PRD-02, BR-PRD-14, ADR-0071, ADR-0123)', () => {
  describe('validSku', () => {
    it('stores the SKU in uppercase', () => {
      expect(validSku('cam-lin_az.m')).toBe('CAM-LIN_AZ.M');
      expect(validSku('A'.repeat(64))).toHaveLength(64);
    });

    it.each(['', 'CAM LIN', 'CAMISA/M', 'CAMISÓN', 'A'.repeat(65)])(
      'rejects %p',
      (sku) => {
        expect(() => validSku(sku)).toThrow(InvalidValueError);
      },
    );
  });

  describe('validOptions', () => {
    it('trims names and values, and lowers the case of the names only', () => {
      expect(validOptions({ ' Talla ': ' M ', COLOR: 'Azul Marino' })).toEqual({
        talla: 'M',
        color: 'Azul Marino',
      });
    });

    it('accepts no options and up to three', () => {
      expect(validOptions({})).toEqual({});
      expect(
        Object.keys(validOptions({ talla: 'M', color: 'Azul', tela: 'Lino' })),
      ).toHaveLength(3);
    });

    it.each([
      ['more than three options', { a: '1', b: '2', c: '3', d: '4' }],
      ['a name that repeats once lowered', { Talla: 'M', talla: 'L' }],
      ['a blank name', { '  ': 'M' }],
      ['a name over 30 characters', { ['n'.repeat(31)]: 'M' }],
      ['a blank value', { talla: '   ' }],
      ['a value over 50 characters', { talla: 'v'.repeat(51) }],
      ['a value that is not text', { talla: 42 }],
    ])('rejects %s, on the options field', (_, options) => {
      expect(() => validOptions(options)).toThrow(InvalidOptionsError);
    });

    it('answers the options as a validation error of their field', () => {
      expect(new InvalidOptionsError('Mensaje.').details).toEqual({
        errors: [{ field: 'options', code: 'options', message: 'Mensaje.' }],
      });
    });
  });

  describe('combinations', () => {
    it('compares names and values, whatever their order', () => {
      expect(
        sameOptions(
          { talla: 'M', color: 'Azul' },
          { color: 'Azul', talla: 'M' },
        ),
      ).toBe(true);
      expect(sameOptions({ talla: 'M' }, { talla: 'L' })).toBe(false);
      expect(sameOptions({ talla: 'M' }, { talla: 'M', color: 'Azul' })).toBe(
        false,
      );
      expect(sameOptions({ talla: 'M' }, { color: 'M' })).toBe(false);
      expect(sameOptions({}, {})).toBe(true);
    });

    it('lists the option names sorted', () => {
      expect(optionNamesOf({ talla: 'M', color: 'Azul' })).toEqual([
        'color',
        'talla',
      ]);
    });
  });

  describe('validDimensions', () => {
    it('keeps whole grams and centimeters with one decimal, all optional', () => {
      const sizes = {
        weightGrams: 350,
        lengthCm: 30.1,
        widthCm: 20,
        heightCm: 0.1,
      };

      expect(validDimensions(sizes)).toEqual(sizes);
      expect(validDimensions(NO_SIZE)).toEqual(NO_SIZE);
      expect(
        validDimensions({
          weightGrams: MAX_WEIGHT_GRAMS,
          lengthCm: MAX_DIMENSION_CM,
          widthCm: null,
          heightCm: null,
        }).lengthCm,
      ).toBe(MAX_DIMENSION_CM);
    });

    it.each([
      { weightGrams: 0 },
      { weightGrams: 350.5 },
      { weightGrams: MAX_WEIGHT_GRAMS + 1 },
      { lengthCm: 0 },
      { widthCm: -1 },
      { heightCm: 30.15 },
      { lengthCm: MAX_DIMENSION_CM + 0.1 },
      { lengthCm: Number.NaN },
    ])('rejects %p', (size) => {
      expect(() => validDimensions({ ...NO_SIZE, ...size })).toThrow(
        InvalidValueError,
      );
    });
  });
});
