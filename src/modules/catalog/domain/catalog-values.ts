import { InvalidValueError } from '../../../shared-kernel/index.js';

/** Status of categories and brands (`catalog_status`, ADR-0038): inactive instead of deleted. */
export type CatalogStatus = 'ACTIVE' | 'INACTIVE';

export const CATALOG_STATUSES: readonly CatalogStatus[] = [
  'ACTIVE',
  'INACTIVE',
];

/** Longest name of a category or a brand (API_SPEC.md §11.9). */
export const MAX_NAME_LENGTH = 100;

/** A name without the spaces around it, from 1 to 100 characters. */
export function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new InvalidValueError(
      `A name has 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  return trimmed;
}
