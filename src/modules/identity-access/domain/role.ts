import {
  type Id,
  InvalidValueError,
  isPermissionCode,
  PERMISSION_CODES,
  type PermissionCode,
} from '../../../shared-kernel/index.js';

export type RoleId = Id<'Role'>;

/** Longest role name (API_SPEC.md §9.16). */
const MAX_NAME_LENGTH = 50;

export interface RoleSnapshot {
  readonly id: RoleId;
  readonly name: string;
  readonly description: string | null;
  /** The role protected by BR-USR-03, which always has every permission. */
  readonly isSuperadmin: boolean;
  /** Stored permissions; always empty for the superadmin role, whose permissions are implicit. */
  readonly permissions: readonly PermissionCode[];
  readonly version: number;
}

/**
 * A staff role (ADR-0017, ADR-0043): a named set of permissions from the catalog in code (BR-USR-04). The
 * superadmin role has every permission of the catalog implicitly, so a permission added to the code reaches
 * it without a migration, and its permissions cannot be edited (ADR-0111).
 */
export class Role {
  private constructor(private state: RoleSnapshot) {}

  static create(props: {
    id: RoleId;
    name: string;
    description: string | null;
    permissions: readonly string[];
  }): Role {
    return new Role({
      id: props.id,
      name: validName(props.name),
      description: props.description,
      isSuperadmin: false,
      permissions: validPermissions(props.permissions),
      version: 1,
    });
  }

  static restore(snapshot: RoleSnapshot): Role {
    return new Role(snapshot);
  }

  get id(): RoleId {
    return this.state.id;
  }

  get isSuperadmin(): boolean {
    return this.state.isSuperadmin;
  }

  get version(): number {
    return this.state.version;
  }

  /** What holders of this role may do: every permission for the superadmin role. */
  effectivePermissions(): readonly PermissionCode[] {
    return this.state.isSuperadmin ? PERMISSION_CODES : this.state.permissions;
  }

  rename(name: string): void {
    this.state = { ...this.state, name: validName(name) };
  }

  describe(description: string | null): void {
    this.state = { ...this.state, description };
  }

  replacePermissions(permissions: readonly string[]): void {
    if (this.state.isSuperadmin) {
      throw new InvalidValueError(
        'The superadmin role always has every permission',
      );
    }
    this.state = { ...this.state, permissions: validPermissions(permissions) };
  }

  /** Called by the repository once a change is saved. */
  markSaved(version: number): void {
    this.state = { ...this.state, version };
  }

  snapshot(): RoleSnapshot {
    return this.state;
  }
}

function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new InvalidValueError(
      `A role name has 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Only codes of the catalog, without repeats (BR-USR-04). */
function validPermissions(permissions: readonly string[]): PermissionCode[] {
  const unknown = permissions.filter((code) => !isPermissionCode(code));
  if (unknown.length > 0) {
    throw new InvalidValueError(`Unknown permissions: ${unknown.join(', ')}`, {
      unknownPermissions: unknown,
    });
  }
  return [...new Set(permissions as PermissionCode[])];
}
