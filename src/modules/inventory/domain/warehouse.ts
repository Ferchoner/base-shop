import {
  DomainError,
  type Id,
  InvalidStateTransitionError,
  InvalidValueError,
  ResourceInUseError,
} from '../../../shared-kernel/index.js';

export type WarehouseId = Id<'Warehouse'>;

/** Longest name of a warehouse (ADR-0127). Only the staff sees it. */
export const MAX_WAREHOUSE_NAME_LENGTH = 100;

/** A warehouse code: 2 to 20 capital letters, digits and hyphens, starting with a letter or digit (ADR-0160). */
export const WAREHOUSE_CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

/** The priorities of a warehouse, 1 the first (ADR-0160). */
export const MIN_WAREHOUSE_PRIORITY = 1;
export const MAX_WAREHOUSE_PRIORITY = 1000;

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
  /** 1 is the first: orders are reserved in the first active warehouse that holds them (ADR-0160). */
  readonly priority: number;
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

/** The last active warehouse cannot be deactivated: every order needs one (ADR-0160). */
export class LastActiveWarehouseError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly category = 'conflict';

  constructor() {
    super('The last active warehouse cannot be deactivated', {
      currentStatus: 'ACTIVE',
      reason: 'last-active-warehouse',
    });
  }
}

/**
 * A warehouse (DATABASE.md §6.1). Several may be active, each order reserved in one of them by priority
 * (ADR-0160); the first one comes from a migration (ADR-0127). The staff creates them, changes their name,
 * address and priority, and deactivates them, for good (ADR-0076). It has no `version`: the last change wins
 * (API_SPEC.md §4).
 */
export class Warehouse {
  private constructor(private state: WarehouseSnapshot) {}

  /**
   * A new active warehouse (UC-INV-10).
   *
   * @throws InvalidValueError for a code, name or priority out of their rules.
   */
  static create(props: {
    id: WarehouseId;
    code: string;
    name: string;
    address: WarehouseAddress | null;
    priority: number;
  }): Warehouse {
    if (!WAREHOUSE_CODE.test(props.code)) {
      throw new InvalidValueError(
        'A warehouse code has 2 to 20 capital letters, digits and hyphens',
      );
    }
    return new Warehouse({
      id: props.id,
      code: props.code,
      name: validName(props.name),
      address: props.address,
      status: 'ACTIVE',
      priority: validPriority(props.priority),
    });
  }

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
    this.state = {
      ...this.state,
      name:
        changes.name === undefined ? this.state.name : validName(changes.name),
      address:
        changes.address === undefined ? this.state.address : changes.address,
    };
  }

  /**
   * Changes the order in which orders are reserved in it (ADR-0160).
   *
   * @throws InvalidValueError when the priority is not a whole number from 1 to 1000.
   */
  prioritize(priority: number): void {
    this.state = { ...this.state, priority: validPriority(priority) };
  }

  /**
   * Deactivates it, for good (UC-INV-11, ADR-0076): it no longer sells, reserves nor receives stock, and keeps
   * what it has. `activeWarehouses` counts it, and `reservedUnits` are the units its stock holds for orders.
   *
   * @throws InvalidStateTransitionError when it is already inactive.
   * @throws LastActiveWarehouseError when it is the only active one.
   * @throws ResourceInUseError when it holds units for orders.
   */
  deactivate(state: { activeWarehouses: number; reservedUnits: number }): void {
    if (!this.isActive) {
      throw new InvalidStateTransitionError(this.state.status, 'deactivate');
    }
    if (state.activeWarehouses <= 1) throw new LastActiveWarehouseError();
    if (state.reservedUnits > 0) {
      throw new ResourceInUseError(
        `Warehouse ${this.state.id} holds units for orders`,
      );
    }
    this.state = { ...this.state, status: 'INACTIVE' };
  }

  snapshot(): WarehouseSnapshot {
    return this.state;
  }
}

/** @throws InvalidValueError when the name, trimmed, is blank or longer than 100 characters. */
function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > MAX_WAREHOUSE_NAME_LENGTH) {
    throw new InvalidValueError(
      `A warehouse name has 1 to ${MAX_WAREHOUSE_NAME_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** @throws InvalidValueError when the priority is not a whole number from 1 to 1000. */
function validPriority(priority: number): number {
  if (
    !Number.isInteger(priority) ||
    priority < MIN_WAREHOUSE_PRIORITY ||
    priority > MAX_WAREHOUSE_PRIORITY
  ) {
    throw new InvalidValueError(
      `A warehouse priority is a whole number from ${MIN_WAREHOUSE_PRIORITY} to ${MAX_WAREHOUSE_PRIORITY}`,
    );
  }
  return priority;
}
