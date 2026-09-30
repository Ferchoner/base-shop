import { jest } from '@jest/globals';
import { DuplicateValueError } from '../../../shared-kernel/index.js';
import { SlugRequiredError } from '../domain/catalog-errors.js';
import {
  GENERATED_SLUG_ATTEMPTS,
  retryingGeneratedSlug,
  slugFor,
} from './catalog-slugs.js';

/** A lookup of taken slugs that also records what it was asked. */
function takenAmong(...taken: string[]) {
  return jest.fn((slugs: readonly string[]) =>
    Promise.resolve(
      new Set(
        slugs.filter((slug) => taken.includes(slug)),
      ) as ReadonlySet<string>,
    ),
  );
}

describe('Slugs of new categories and brands (ADR-0120)', () => {
  describe('slugFor', () => {
    it('keeps the slug the staff gave, without looking it up', async () => {
      const taken = takenAmong('camisas');

      expect(await slugFor('Camisas', 'camisas', taken)).toBe('camisas');
      expect(taken).not.toHaveBeenCalled();
    });

    it('generates the slug from the name', async () => {
      expect(await slugFor('Camisas de Vestir', undefined, takenAmong())).toBe(
        'camisas-de-vestir',
      );
    });

    it('numbers a generated slug that is taken, with the first free number, in one lookup', async () => {
      const taken = takenAmong('camisas', 'camisas-2', 'camisas-4');

      expect(await slugFor('Camisas', undefined, taken)).toBe('camisas-3');
      expect(taken).toHaveBeenCalledTimes(1);
    });

    it('asks for a slug when the name gives none', async () => {
      await expect(slugFor('¡!', undefined, takenAmong())).rejects.toThrow(
        SlugRequiredError,
      );
    });

    it('gives up with a duplicate slug when every numbered slug is taken', async () => {
      const everything = jest.fn((slugs: readonly string[]) =>
        Promise.resolve(new Set(slugs) as ReadonlySet<string>),
      );

      await expect(slugFor('Camisas', undefined, everything)).rejects.toEqual(
        new DuplicateValueError('slug'),
      );
    });
  });

  describe('retryingGeneratedSlug', () => {
    const slugRace = () => Promise.reject(new DuplicateValueError('slug'));

    it('creates again when another creation took the generated slug meanwhile', async () => {
      const create = jest
        .fn<() => Promise<string>>()
        .mockImplementationOnce(slugRace)
        .mockResolvedValueOnce('created');

      expect(await retryingGeneratedSlug(undefined, create)).toBe('created');
      expect(create).toHaveBeenCalledTimes(2);
    });

    it(`gives up after ${GENERATED_SLUG_ATTEMPTS} attempts`, async () => {
      const create = jest.fn<() => Promise<string>>(slugRace);

      await expect(retryingGeneratedSlug(undefined, create)).rejects.toEqual(
        new DuplicateValueError('slug'),
      );
      expect(create).toHaveBeenCalledTimes(GENERATED_SLUG_ATTEMPTS);
    });

    it('never retries a slug the staff gave', async () => {
      const create = jest.fn<() => Promise<string>>(slugRace);

      await expect(retryingGeneratedSlug('camisas', create)).rejects.toEqual(
        new DuplicateValueError('slug'),
      );
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('never retries other errors, such as a repeated name', async () => {
      const create = jest.fn<() => Promise<string>>(() =>
        Promise.reject(new DuplicateValueError('name')),
      );

      await expect(retryingGeneratedSlug(undefined, create)).rejects.toEqual(
        new DuplicateValueError('name'),
      );
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
