import type { User, UserId } from './user.js';

/**
 * Stored accounts (DATABASE.md §3.1, §3.3). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class UserRepository {
  abstract findById(id: UserId): Promise<User | null>;

  /**
   * Saves the account and its roles, recording who assigned new roles. Rejects with `VersionConflictError`
   * when another change was saved since the account was read (optimistic locking).
   */
  abstract save(user: User, changedBy: UserId | null): Promise<void>;
}
