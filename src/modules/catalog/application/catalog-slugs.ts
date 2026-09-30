import { DuplicateValueError } from '../../../shared-kernel/index.js';
import { SlugRequiredError } from '../domain/catalog-errors.js';
import { slugCandidates, slugFromName } from '../domain/slug.js';

/** Tries to save a category or brand with a generated slug up to this many times (ADR-0120). */
export const GENERATED_SLUG_ATTEMPTS = 3;

/**
 * The slug of a new category, brand or product (ADR-0120, ADR-0123): the one the staff gave, as is, or one
 * generated from the name or title. A generated slug that is taken gets the first free number: `camisas`,
 * `camisas-2`, `camisas-3`…
 */
export async function slugFor(
  name: string,
  given: string | undefined,
  takenSlugs: (slugs: readonly string[]) => Promise<ReadonlySet<string>>,
  maxLength?: number,
): Promise<string> {
  if (given !== undefined) return given;
  const base = slugFromName(name, maxLength);
  if (base === null) throw new SlugRequiredError();
  const candidates = slugCandidates(base, maxLength);
  const taken = await takenSlugs(candidates);
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (free === undefined) throw new DuplicateValueError('slug');
  return free;
}

/**
 * Runs `create` again when another creation took the same generated slug between choosing and saving it,
 * so the staff never sees a conflict on a slug they did not send. A slug they gave is never retried: it
 * answers 409 `duplicate-value`.
 */
export async function retryingGeneratedSlug<T>(
  given: string | undefined,
  create: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await create();
    } catch (error) {
      const slugRace =
        given === undefined &&
        error instanceof DuplicateValueError &&
        error.details?.field === 'slug';
      if (!slugRace || attempt === GENERATED_SLUG_ATTEMPTS) throw error;
    }
  }
}
