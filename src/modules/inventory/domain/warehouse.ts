import {
  DomainError,
  type Id,
  InvalidValueError,
} from '../../../shared-kernel/index.js';

export type WarehouseId = Id<'Warehouse'>;

/** Longest name of a warehouse (ADR-0127). Only the staff sees it. */
export const MAX_WAREHOUSE_NAME_LENGTH = 100;

/**
 * The address of a warehouse in the format of ADR-0057, with the names of its state and municipality as they
 * were when it was set.
 */
export interface WarehouseAddress {
  readonly recipientName: string;
  readonly phone: string;
  readonly street: string;
  readonly exteriorNumber: string;
  readonly interiorNumber: string | null;
  readonly neighborhood: string;
  readonly postalCode: string;
  readonly stateCode: string;
  readonly stateName: string;
  readonly municipalityCode: string;
  readonly municipalityName: string;
  readonly city: string | null;
  readonly references: string | null;
  readonly country: 'MX';
}

export type WarehouseStatus = 'ACTIVE' | 'INACTIVE';

export interface WarehouseSnapshot {
  readonly id: WarehouseId;
  readonly code: string;
  readonly name: string;
  readonly address: WarehouseAddress | null;
  readonly status: WarehouseStatus;
}

/** Why a state and municipality cannot be an address (BR-ADR-02, BR-ADR-03). */
export type LocationProblem =
  'unknown-state' | 'municipality-not-in-state' | 'inactive-municipality';

const LOCATION_ERRORS: Record<
  LocationProblem,
  { field: string; code: string; message: string }
> = {
  'unknown-state': {
    field: 'address.stateCode',
    code: 'isState',
    message: 'El estado no existe.',
  },
  'municipality-not-in-state': {
    field: 'address.municipalityCode',
    code: 'isMunicipalityOfState',
    message: 'El municipio no pertenece al estado elegido.',
  },
  'inactive-municipality': {
    field: 'address.municipalityCode',
    code: 'isActiveMunicipality',
    message:
      'El municipio ya no está en el catálogo del INEGI; elige uno vigente.',
  },
};

/** The state or municipality of the warehouse address is not valid. Answered as a validation error. */
export class InvalidWarehouseLocationError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(problem: LocationProblem) {
    super(`Invalid warehouse location: ${problem}`, {
      errors: [LOCATION_ERRORS[problem]],
    });
  }
}

/**
 * The warehouse (DATABASE.md §6.1). The MVP has exactly one, created by a migration (ADR-0081, ADR-0127);
 * the staff changes only its name and address. It has no `version`: the last change wins (API_SPEC.md §4).
 */
export class Warehouse {
  private constructor(private state: WarehouseSnapshot) {}

  static restore(snapshot: WarehouseSnapshot): Warehouse {
    return new Warehouse(snapshot);
  }

  get id(): WarehouseId {
    return this.state.id;
  }

  get isActive(): boolean {
    return this.state.status === 'ACTIVE';
  }

  /**
   * Changes the name, the address, or both; what is not given stays. `null` takes the address away.
   *
   * @throws InvalidValueError when the name is blank or longer than 100 characters.
   */
  describe(changes: {
    name?: string;
    address?: WarehouseAddress | null;
  }): void {
    let { name } = this.state;
    if (changes.name !== undefined) {
      name = changes.name.trim();
      if (name === '' || name.length > MAX_WAREHOUSE_NAME_LENGTH) {
        throw new InvalidValueError(
          `A warehouse name has 1 to ${MAX_WAREHOUSE_NAME_LENGTH} characters`,
        );
      }
    }
    this.state = {
      ...this.state,
      name,
      address:
        changes.address === undefined ? this.state.address : changes.address,
    };
  }

  snapshot(): WarehouseSnapshot {
    return this.state;
  }
}
