import { InvalidValueError } from '../../../shared-kernel/index.js';
import {
  MAX_SLUG_LENGTH,
  SLUG_CANDIDATES,
  slugCandidates,
  slugFromName,
  validSlug,
} from './slug.js';

describe('Slugs of categories and brands (ADR-0072, ADR-0120)', () => {
  describe('slugFromName', () => {
    it.each([
      ['Camisas de Vestir', 'camisas-de-vestir'],
      ['Niños y Niñas', 'ninos-y-ninas'],
      ['  Electrónica & Cómputo!  ', 'electronica-computo'],
      ['CAFÉ, té  y   más', 'cafe-te-y-mas'],
      ['Tallas 2XL–3XL', 'tallas-2xl-3xl'],
      ['Güera', 'guera'],
      // Compatibility characters split into plain letters.
      ['Oﬁcina', 'oficina'],
    ])('turns "%s" into %s', (name, slug) => {
      expect(slugFromName(name)).toBe(slug);
    });

    it('gives null for a name without letters or digits it can keep', () => {
      expect(slugFromName('¡!')).toBeNull();
      expect(slugFromName('日本')).toBeNull();
    });

    it('cuts a long name to the longest slug, without a hyphen at the end', () => {
      const slug = slugFromName(`${'a'.repeat(99)} bcd`);

      expect(slug).toBe('a'.repeat(99));
      expect(slugFromName('a'.repeat(150))).toHaveLength(MAX_SLUG_LENGTH);
    });
  });

  describe('validSlug', () => {
    it('accepts lowercase letters and digits joined by single hyphens', () => {
      expect(validSlug('camisas-2')).toBe('camisas-2');
      expect(validSlug('a'.repeat(MAX_SLUG_LENGTH))).toHaveLength(
        MAX_SLUG_LENGTH,
      );
    });

    it.each([
      '',
      'Camisas',
      'camisas--2',
      '-camisas',
      'camisas-',
      'niños',
      'camisas de vestir',
      'a'.repeat(MAX_SLUG_LENGTH + 1),
    ])('rejects "%s"', (slug) => {
      expect(() => validSlug(slug)).toThrow(InvalidValueError);
    });
  });

  describe('slugCandidates', () => {
    it('tries the slug itself, then numbered ones from 2', () => {
      const candidates = slugCandidates('camisas');

      expect(candidates).toHaveLength(SLUG_CANDIDATES);
      expect(candidates.slice(0, 3)).toEqual([
        'camisas',
        'camisas-2',
        'camisas-3',
      ]);
      expect(candidates.at(-1)).toBe(`camisas-${SLUG_CANDIDATES}`);
    });

    it('shortens a long slug to make room for its number, never past the longest slug', () => {
      const base = `${'a'.repeat(97)}-bc`;
      const candidates = slugCandidates(base);

      expect(candidates[0]).toBe(base);
      // 98 characters would end in a hyphen, which is dropped before the number.
      expect(candidates[1]).toBe(`${'a'.repeat(97)}-2`);
      expect(candidates[9]).toBe(`${'a'.repeat(97)}-10`);
      expect(candidates[99]).toBe(`${'a'.repeat(96)}-100`);
      for (const candidate of candidates) {
        expect(candidate.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
        expect(validSlug(candidate)).toBe(candidate);
      }
    });
  });
});
