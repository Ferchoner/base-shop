import type { GeoMunicipality, GeoState } from './geo-catalog.js';

/**
 * Stored geographic catalog (ADR-0057). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class GeoCatalogRepository {
  /** The whole catalog, including inactive municipalities, to plan an import. */
  abstract loadAll(): Promise<{
    states: GeoState[];
    municipalities: GeoMunicipality[];
  }>;

  /** Creates or updates the given rows. Never deletes. */
  abstract save(
    states: readonly GeoState[],
    municipalities: readonly GeoMunicipality[],
  ): Promise<void>;

  /** Every state, ordered by name. */
  abstract listStates(): Promise<GeoState[]>;

  abstract findState(code: string): Promise<GeoState | null>;

  /** The active municipalities of a state, ordered by name. */
  abstract listActiveMunicipalities(
    stateCode: string,
  ): Promise<GeoMunicipality[]>;

  abstract findMunicipality(code: string): Promise<GeoMunicipality | null>;
}
