import {
  InvalidValueError,
  newId,
  PERMISSION_CODES,
} from '../../../shared-kernel/index.js';
import { Role, type RoleSnapshot } from './role.js';

const superadmin = (): Role =>
  Role.restore({
    id: newId<'Role'>(),
    name: 'Superadministrador',
    description: null,
    isSuperadmin: true,
    permissions: [],
    version: 1,
  } satisfies RoleSnapshot);

describe('Role (ADR-0017, ADR-0043, ADR-0111)', () => {
  it('creates a role with permissions of the catalog, without repeats and with a trimmed name', () => {
    const role = Role.create({
      id: newId(),
      name: '  Soporte  ',
      description: 'Atiende a clientes',
      permissions: ['customers.read', 'orders.read', 'customers.read'],
    });

    expect(role.snapshot()).toMatchObject({
      name: 'Soporte',
      isSuperadmin: false,
      permissions: ['customers.read', 'orders.read'],
      version: 1,
    });
    expect(role.effectivePermissions()).toEqual([
      'customers.read',
      'orders.read',
    ]);
  });

  it('rejects a permission outside the catalog in code (BR-USR-04)', () => {
    const create = () =>
      Role.create({
        id: newId(),
        name: 'Soporte',
        description: null,
        permissions: ['customers.read', 'customers.delete'],
      });

    expect(create).toThrow(InvalidValueError);
    expect(create).toThrow('Unknown permissions: customers.delete');
  });

  it.each(['', '   ', 'x'.repeat(51)])('rejects the name %p', (name) => {
    expect(() =>
      Role.create({ id: newId(), name, description: null, permissions: [] }),
    ).toThrow(InvalidValueError);
  });

  it('renames and replaces the permissions of a regular role', () => {
    const role = Role.create({
      id: newId(),
      name: 'Soporte',
      description: null,
      permissions: ['customers.read'],
    });

    role.rename('Atención');
    role.replacePermissions(['orders.read']);

    expect(role.snapshot()).toMatchObject({
      name: 'Atención',
      permissions: ['orders.read'],
    });
  });

  it('gives the superadmin role every permission of the catalog, stored or not', () => {
    expect(superadmin().effectivePermissions()).toEqual(PERMISSION_CODES);
  });

  it('never changes the permissions of the superadmin role', () => {
    expect(() => superadmin().replacePermissions(['orders.read'])).toThrow(
      'The superadmin role always has every permission',
    );
  });
});
