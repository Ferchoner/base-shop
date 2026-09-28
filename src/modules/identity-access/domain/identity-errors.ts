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
