import type { Role, RoleId } from './role.js';

/**
 * Stored roles and their permissions (DATABASE.md §3.2, §3.4). An abstract class rather than an interface,
 * so it can be the dependency injection token without depending on NestJS.
 */
export abstract class RoleRepository {
  abstract findById(id: RoleId): Promise<Role | null>;

  abstract findByIds(ids: readonly RoleId[]): Promise<Role[]>;

  /**
   * Creates a new role or saves the changes of a stored one with its permissions. Rejects with
   * `VersionConflictError` when another change was saved since the role was read (optimistic locking).
   */
  abstract save(role: Role): Promise<void>;
}
