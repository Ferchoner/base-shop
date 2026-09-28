import { Injectable } from '@nestjs/common';
import {
  type GeoMunicipality,
  type GeoState,
  GeoStateNotFoundError,
  isStateCode,
} from '../domain/geo-catalog.js';
import { GeoCatalogRepository } from '../domain/geo-catalog.repository.js';

/**
 * Read-only access to the geographic catalog (ADR-0057): the public endpoints (UC-IAM-22), the addresses of
 * Identity & Access and the guest checkout of Ordering use it. It reads the database directly; only the
 * public endpoints are cached.
 */
@Injectable()
export class GeoCatalog {
  constructor(private readonly repository: GeoCatalogRepository) {}

  /** The 32 states, ordered by name. */
  listStates(): Promise<GeoState[]> {
    return this.repository.listStates();
  }

  /**
   * The active municipalities of a state, ordered by name. A key that is not a stored state, well formed
   * or not, is `GeoStateNotFoundError`.
   */
  async listActiveMunicipalities(
    stateCode: string,
  ): Promise<GeoMunicipality[]> {
    const state = isStateCode(stateCode)
      ? await this.repository.findState(stateCode)
      : null;
    if (state === null) throw new GeoStateNotFoundError(stateCode);
    return this.repository.listActiveMunicipalities(stateCode);
  }

  /** A state by its 2-digit key, or null if it does not exist. */
  findState(code: string): Promise<GeoState | null> {
    return isStateCode(code)
      ? this.repository.findState(code)
      : Promise.resolve(null);
  }

  /** A municipality by its 5-digit key, active or not, or null if it does not exist. */
  findMunicipality(code: string): Promise<GeoMunicipality | null> {
    return this.repository.findMunicipality(code);
  }
}
