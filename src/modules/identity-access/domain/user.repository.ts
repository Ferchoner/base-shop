import type { RoleId } from './role.js';
import type { User, UserId } from './user.js';

/**
 * Stored accounts (DATABASE.md §3.1, §3.3). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class UserRepository {
  abstract findById(id: UserId): Promise<User | null>;

  /** The account with this email, already normalized to lowercase (BR-USR-01). */
  abstract findByEmail(email: string): Promise<User | null>;

  /**
   * Records a successful sign-in. It is not a change to the account, so the version stays and an
   * administrator editing it at the same time gets no conflict.
   */
  abstract recordSignIn(id: UserId, at: Date): Promise<void>;

  /**
   * Stores a new account and its roles, recording who assigned them (`null` for the system). Rejects with
   * `DuplicateValueError` on the `email` when another account, customer or staff, has it (BR-USR-01).
   */
  abstract add(user: User, createdBy: UserId | null): Promise<void>;

  /**
   * Saves the account and its roles, recording who assigned new roles. Rejects with `VersionConflictError`
   * when another change was saved since the account was read (optimistic locking), and with
   * `DuplicateValueError` on the `email` when a new email belongs to another account.
   */
  abstract save(user: User, changedBy: UserId | null): Promise<void>;

  /** ACTIVE staff members holding the role, not counting `except` when given. */
  abstract countActiveStaffWithRole(
    roleId: RoleId,
    except?: UserId,
  ): Promise<number>;
}
