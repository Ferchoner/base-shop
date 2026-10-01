import { Injectable } from '@nestjs/common';
import { GeoCatalog } from '../../geo/index.js';
import {
  type LocationNames,
  WarehouseLocations,
} from '../application/warehouse-locations.js';
import type { LocationProblem } from '../domain/warehouse.js';

/**
 * Answers Inventory's `WarehouseLocations` port with the `geo` module's read facade (ADR-0113, ADR-0127),
 * with the same rules as the addresses of customers.
 */
@Injectable()
export class GeoWarehouseLocations extends WarehouseLocations {
  constructor(private readonly geo: GeoCatalog) {
    super();
  }

  async resolve(
    stateCode: string,
    municipalityCode: string,
  ): Promise<LocationNames | LocationProblem> {
    const state = await this.geo.findState(stateCode);
    if (state === null) return 'unknown-state';
    const municipality = await this.geo.findMunicipality(municipalityCode);
    if (municipality === null || municipality.stateCode !== stateCode) {
      return 'municipality-not-in-state';
    }
    if (!municipality.isActive) return 'inactive-municipality';
    return { stateName: state.name, municipalityName: municipality.name };
  }
}
