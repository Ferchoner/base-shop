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
   * `VersionConflictError` when another change was saved since the role was read (optimistic locking), and
   * with `DuplicateValueError` on the `name` when another role has it.
   */
  abstract save(role: Role): Promise<void>;

  /** Deletes a role and its permissions; rejects with `ResourceInUseError` if a user got it meanwhile. */
  abstract delete(role: Role): Promise<void>;

  abstract countUsers(id: RoleId): Promise<number>;

  /**
   * The superadmin role, locked until the transaction ends (`SELECT … FOR UPDATE`). Every change that could
   * remove the last active superadmin takes this lock first, so two of them never run their check at the
   * same time (BR-USR-03, ADR-0112).
   */
  abstract lockSuperadminRole(): Promise<RoleId>;
}
