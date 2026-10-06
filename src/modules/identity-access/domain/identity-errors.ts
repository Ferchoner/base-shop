import { DomainError } from '../../../shared-kernel/index.js';

/**
 * The change would leave the system without an ACTIVE staff member holding the superadmin role, or would
 * delete that role (BR-USR-03, E-29).
 */
export class LastSuperadminError extends DomainError {
  readonly code = 'last-superadmin';
  readonly category = 'conflict';

  constructor() {
    super('The system must keep at least one active superadmin');
  }
}

/**
 * A role other than the superadmin role was given a permission that only the superadmin role holds (BR-USR-21,
 * ADR-0162), such as `payments.configure`. Answered as a validation error of the `permissions` field.
 */
export class SuperadminOnlyPermissionError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(permissions: readonly string[]) {
    super(`Only the superadmin role holds ${permissions.join(', ')}`, {
      errors: [
        {
          field: 'permissions',
          code: 'superadminOnly',
          message: `Solo el rol superadministrador tiene ${permissions.join(', ')}.`,
        },
      ],
    });
  }
}

/**
 * The permissions of the superadmin role cannot be edited: it always has every permission (API_SPEC.md
 * §9.16, ADR-0112). Answered as a validation error of the `permissions` field, like any other.
 */
export class SuperadminPermissionsFixedError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor() {
    super('The superadmin role always has every permission', {
      errors: [
        {
          field: 'permissions',
          code: 'superadminPermissions',
          message:
            'El rol superadministrador siempre tiene todos los permisos.',
        },
      ],
    });
  }
}

/**
 * A staff member tried to give a role or permission they do not hold, or the superadmin role without being a
 * superadmin (BR-USR-20, ADR-0154). Answered as any other denied access, and audited as one.
 */
export class PermissionNotHeldError extends DomainError {
  readonly code = 'forbidden';
  readonly category = 'forbidden';

  constructor() {
    super('Nobody grants a role or permission they do not hold');
  }
}

/** A role given to a staff member does not exist. Answered as a validation error of `roleIds`. */
export class UnknownRolesError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor() {
    super('One or more roles do not exist', {
      errors: [
        {
          field: 'roleIds',
          code: 'unknownRoles',
          message: 'Uno o más roles no existen.',
        },
      ],
    });
  }
}

/** Why a state and municipality pair cannot be used in an address (BR-ADR-02, BR-ADR-03). */
export type AddressLocationProblem =
  'unknown-state' | 'municipality-not-in-state' | 'inactive-municipality';

const LOCATION_ERRORS: Record<
  AddressLocationProblem,
  { field: string; code: string; message: string }
> = {
  'unknown-state': {
    field: 'stateCode',
    code: 'isState',
    message: 'El estado no existe.',
  },
  'municipality-not-in-state': {
    field: 'municipalityCode',
    code: 'isMunicipalityOfState',
    message: 'El municipio no pertenece al estado elegido.',
  },
  'inactive-municipality': {
    field: 'municipalityCode',
    code: 'isActiveMunicipality',
    message:
      'El municipio ya no está en el catálogo del INEGI; elige uno vigente.',
  },
};

/**
 * The state or municipality of an address is not valid (BR-ADR-02, BR-ADR-03). Answered as a validation
 * error of the field, like the example of API_SPEC.md §6.1.
 */
export class InvalidAddressLocationError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor(problem: AddressLocationProblem) {
    super(`Invalid address location: ${problem}`, {
      errors: [LOCATION_ERRORS[problem]],
    });
  }
}

/** The new email is the one the account already has (UC-IAM-10, ADR-0117): a validation error of `newEmail`. */
export class SameEmailError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';

  constructor() {
    super('The new email is the current one', {
      errors: [
        {
          field: 'newEmail',
          code: 'sameEmail',
          message: 'Es el correo que ya tienes.',
        },
      ],
    });
  }
}
