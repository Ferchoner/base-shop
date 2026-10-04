import {
  newId,
  PERMISSION_CODES,
  type PermissionCode,
} from '../../../shared-kernel/index.js';
import { PermissionNotHeldError } from '../domain/identity-errors.js';
import { Role, type RoleId } from '../domain/role.js';
import type { RoleRepository } from '../domain/role.repository.js';
import { User, type UserId } from '../domain/user.js';
import type { UserRepository } from '../domain/user.repository.js';
import { GrantLimits } from './grant-limits.js';

const NOW = new Date('2026-10-03T12:00:00.000Z');

function role(permissions: PermissionCode[], isSuperadmin = false): Role {
  return Role.restore({
    id: newId(),
    name: `Rol ${permissions.join(' ')}`,
    description: null,
    isSuperadmin,
    permissions: isSuperadmin ? [] : permissions,
    version: 1,
  });
}

const SUPERADMIN = role([], true);
const ORDERS = role(['orders.read', 'orders.manage']);
const ORDERS_READ = role(['orders.read']);
const STAFF = role(['staff.manage', 'orders.read']);
/** Every permission of the catalog, without being the superadmin role. */
const EVERY_PERMISSION = role([...PERMISSION_CODES]);

/** Grant limits over fixed users and roles, kept in memory. */
function limitsWith(users: readonly User[]): GrantLimits {
  const roles = [SUPERADMIN, ORDERS, ORDERS_READ, STAFF, EVERY_PERMISSION];
  const userRepository = {
    findById: (id: UserId) =>
      Promise.resolve(users.find((user) => user.id === id) ?? null),
  } as unknown as UserRepository;
  const roleRepository = {
    findByIds: (ids: readonly RoleId[]) =>
      Promise.resolve(roles.filter((candidate) => ids.includes(candidate.id))),
  } as unknown as RoleRepository;
  return new GrantLimits(userRepository, roleRepository);
}

function staff(...roles: Role[]): User {
  return User.createStaff({
    id: newId(),
    email: `${newId()}@example.com`,
    firstNames: 'Ana',
    lastNames: 'Pérez',
    roleIds: roles.map((held) => held.id),
    temporaryPasswordHash: 'hash',
    now: NOW,
  });
}

describe('GrantLimits (BR-USR-20, ADR-0154)', () => {
  it('lets a staff member give roles and permissions they hold', async () => {
    const actor = staff(STAFF, ORDERS);
    const limits = limitsWith([actor]);

    await expect(
      limits.assertCanGrantRoles(actor.id, [ORDERS, ORDERS_READ, STAFF]),
    ).resolves.toBeUndefined();
    await expect(
      limits.assertCanGrantPermissions(actor.id, ['orders.manage']),
    ).resolves.toBeUndefined();
  });

  it('rejects a role with one permission the actor lacks', async () => {
    const actor = staff(STAFF, ORDERS_READ);
    const limits = limitsWith([actor]);

    await expect(
      limits.assertCanGrantRoles(actor.id, [ORDERS_READ, ORDERS]),
    ).rejects.toThrow(PermissionNotHeldError);
    await expect(
      limits.assertCanGrantPermissions(actor.id, [
        'orders.read',
        'orders.manage',
      ]),
    ).rejects.toThrow(PermissionNotHeldError);
  });

  it('lets only a superadmin give the superadmin role', async () => {
    const superadmin = staff(SUPERADMIN);
    const everything = staff(EVERY_PERMISSION);
    const limits = limitsWith([superadmin, everything]);

    await expect(
      limits.assertCanGrantRoles(superadmin.id, [SUPERADMIN, ORDERS]),
    ).resolves.toBeUndefined();
    await expect(
      limits.assertCanGrantRoles(everything.id, [SUPERADMIN]),
    ).rejects.toThrow(PermissionNotHeldError);
  });

  it('gives a superadmin every permission of the catalog', async () => {
    const superadmin = staff(SUPERADMIN);

    await expect(
      limitsWith([superadmin]).assertCanGrantPermissions(
        superadmin.id,
        SUPERADMIN.effectivePermissions(),
      ),
    ).resolves.toBeUndefined();
  });

  it('lets anyone give nothing', async () => {
    const limits = limitsWith([]);

    await expect(
      limits.assertCanGrantRoles(newId(), []),
    ).resolves.toBeUndefined();
    await expect(
      limits.assertCanGrantPermissions(newId(), []),
    ).resolves.toBeUndefined();
  });

  it('gives nothing to an actor that is unknown, suspended or a customer', async () => {
    const suspended = staff(SUPERADMIN);
    suspended.suspend(NOW);
    const customer = User.registerCustomer({
      id: newId(),
      email: 'cliente@example.com',
      firstNames: 'Luis',
      lastNames: 'García',
      passwordHash: 'hash',
      privacyNoticeVersion: '2026-09',
      now: NOW,
    });
    const limits = limitsWith([suspended, customer]);

    for (const actorId of [newId<'User'>(), suspended.id, customer.id]) {
      await expect(
        limits.assertCanGrantRoles(actorId, [ORDERS_READ]),
      ).rejects.toThrow(PermissionNotHeldError);
      await expect(
        limits.assertCanGrantPermissions(actorId, ['orders.read']),
      ).rejects.toThrow(PermissionNotHeldError);
    }
  });
});
