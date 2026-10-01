import type { LocationProblem } from '../domain/warehouse.js';

/** The names of a state and one of its municipalities, as the INEGI catalog has them. */
export interface LocationNames {
  readonly stateName: string;
  readonly municipalityName: string;
}

/**
 * The address of the warehouse needs the geographic catalog of the `geo` module (ADR-0057), which Inventory's
 * application layer cannot import (ADR-0103). This port states what it needs; an adapter in Inventory's
 * infrastructure answers it through the `geo` module's facade, as Identity does (ADR-0113, ADR-0127). An
 * abstract class rather than an interface, so it can be the dependency injection token without depending on
 * NestJS.
 */
export abstract class WarehouseLocations {
  /** The names of the state and municipality, or what is wrong with them. */
  abstract resolve(
    stateCode: string,
    municipalityCode: string,
  ): Promise<LocationNames | LocationProblem>;
}
