import { Injectable } from '@nestjs/common';
import { GeoCatalog } from '../../geo/index.js';
import { AddressLocations } from '../application/address-locations.js';
import type { AddressLocationProblem } from '../domain/identity-errors.js';

/**
 * Answers Identity's `AddressLocations` port with the `geo` module's read facade (ADR-0113): the way one
 * context uses another, through the other's `index.ts` and only from infrastructure.
 */
@Injectable()
export class GeoAddressLocations extends AddressLocations {
  constructor(private readonly geo: GeoCatalog) {
    super();
  }

  async check(
    stateCode: string,
    municipalityCode: string,
  ): Promise<AddressLocationProblem | null> {
    if ((await this.geo.findState(stateCode)) === null) return 'unknown-state';
    const municipality = await this.geo.findMunicipality(municipalityCode);
    if (municipality === null || municipality.stateCode !== stateCode) {
      return 'municipality-not-in-state';
    }
    return municipality.isActive ? null : 'inactive-municipality';
  }
}
