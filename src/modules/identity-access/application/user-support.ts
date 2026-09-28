import { NotFoundError } from '../../../shared-kernel/index.js';
import type { User, UserId, UserType } from '../domain/user.js';
import type { UserRepository } from '../domain/user.repository.js';

/**
 * A staff member or a customer by id. An account of the other type is answered as missing too, so staff
 * routes never act on customers and the other way around.
 */
export async function findUserOfType(
  users: UserRepository,
  id: UserId,
  type: UserType,
): Promise<User> {
  const user = await users.findById(id);
  if (user === null || user.type !== type) {
    throw new NotFoundError(type === 'STAFF' ? 'Staff member' : 'Customer', id);
  }
  return user;
}
