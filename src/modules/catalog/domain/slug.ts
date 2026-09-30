import { InvalidValueError } from '../../../shared-kernel/index.js';

/** Longest slug of a category or a brand (API_SPEC.md §11.9). */
export const MAX_SLUG_LENGTH = 100;

/** Lowercase letters and digits in groups joined by single hyphens, such as `camisas-de-vestir`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** How many numbered slugs a generated slug tries before giving up: `camisas`, `camisas-2` … `camisas-100`. */
export const SLUG_CANDIDATES = 100;

/** A slug chosen by the staff, checked again here although the API validates it first. */
export function validSlug(slug: string): string {
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new InvalidValueError(
      `A slug has 1 to ${MAX_SLUG_LENGTH} lowercase letters, digits and single hyphens`,
    );
  }
  return slug;
}

/**
 * The slug of a name: without accents, in lowercase, with hyphens between words ("Camisas de Vestir" →
 * `camisas-de-vestir`). `null` when the name has no letter or digit it can keep, such as "¡!".
 */
export function slugFromName(name: string): string | null {
  const slug = name
    // NFKD also splits compatibility characters, such as "ﬁ" into "fi".
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = cutTo(slug, MAX_SLUG_LENGTH);
  return cut === '' ? null : cut;
}

/**
 * The slugs to try, in order, when a generated slug may be taken (ADR-0120): the slug itself and then
 * numbered ones, `camisas-2`, `camisas-3`… A long slug is shortened to make room for its number.
 */
export function slugCandidates(base: string): string[] {
  const candidates = [base];
  for (let n = 2; n <= SLUG_CANDIDATES; n += 1) {
    const suffix = `-${n}`;
    candidates.push(`${cutTo(base, MAX_SLUG_LENGTH - suffix.length)}${suffix}`);
  }
  return candidates;
}

/** The first `length` characters, without a hyphen left at the end. */
function cutTo(slug: string, length: number): string {
  return slug.slice(0, length).replace(/-+$/, '');
}
