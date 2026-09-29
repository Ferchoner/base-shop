import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
} from '../../../shared-kernel/index.js';
import type { RoleId } from './role.js';
import {
  normalizeEmail,
  User,
  type UserSnapshot,
  type UserStatus,
  type UserType,
} from './user.js';

function user(type: UserType, status: UserStatus = 'ACTIVE'): User {
  return User.restore({
    id: newId(),
    type,
    status,
    email: 'persona@example.com',
    firstNames: 'Ana',
    lastNames: 'Pérez',
    emailVerifiedAt: null,
    passwordHash: status === 'ANONYMIZED' ? null : '$argon2id$v=19$…',
    passwordChangedAt: null,
    mustChangePassword: false,
    lastLoginAt: null,
    suspendedAt: status === 'SUSPENDED' ? new Date('2026-09-01') : null,
    anonymizedAt: null,
    createdAt: new Date('2026-08-01'),
    roleIds: [],
    version: 3,
  } satisfies UserSnapshot);
}

const NOW = new Date('2026-09-28T12:00:00Z');

describe('User (ADR-0043, ADR-0076)', () => {
  describe('suspend (BR-USR-02, BR-USR-06)', () => {
    it.each(['CUSTOMER', 'STAFF'] as const)(
      'suspends an active %s and records when',
      (type) => {
        const account = user(type);

        account.suspend(NOW);

        expect(account.snapshot()).toMatchObject({
          status: 'SUSPENDED',
          suspendedAt: NOW,
        });
      },
    );

    it.each(['SUSPENDED', 'ANONYMIZED'] as const)(
      'rejects suspending a %s account with its current status',
      (status) => {
        const suspend = () => user('CUSTOMER', status).suspend(NOW);

        expect(suspend).toThrow(InvalidStateTransitionError);
        try {
          suspend();
        } catch (error) {
          expect((error as InvalidStateTransitionError).details).toEqual({
            currentStatus: status,
          });
        }
      },
    );
  });

  describe('reactivateCustomer (BR-USR-14)', () => {
    it('reactivates a suspended customer', () => {
      const customer = user('CUSTOMER', 'SUSPENDED');

      customer.reactivateCustomer();

      expect(customer.snapshot()).toMatchObject({
        status: 'ACTIVE',
        suspendedAt: null,
      });
    });

    it.each(['ACTIVE', 'ANONYMIZED'] as const)(
      'rejects reactivating a %s customer: an anonymized account never comes back',
      (status) => {
        expect(() => user('CUSTOMER', status).reactivateCustomer()).toThrow(
          InvalidStateTransitionError,
        );
      },
    );

    it('leaves staff reactivation to T-131, which issues a temporary password', () => {
      expect(() => user('STAFF', 'SUSPENDED').reactivateCustomer()).toThrow(
        'Staff reactivation issues a temporary password (T-131)',
      );
    });
  });

  describe('replaceRoles (BR-USR-08)', () => {
    const [a, b] = [newId<'Role'>(), newId<'Role'>()] as RoleId[];

    it('replaces the roles of a staff member, without repeats', () => {
      const staff = user('STAFF');

      staff.replaceRoles([a, b, a]);

      expect(staff.roleIds).toEqual([a, b]);
    });

    it('never gives roles to a customer', () => {
      expect(() => user('CUSTOMER').replaceRoles([a])).toThrow(
        'Customers never have roles',
      );
    });

    it('keeps at least one role', () => {
      expect(() => user('STAFF').replaceRoles([])).toThrow(InvalidValueError);
    });
  });

  describe('canSignIn (BR-USR-02, ADR-0114)', () => {
    it.each(['CUSTOMER', 'STAFF'] as const)(
      'lets an active %s sign in',
      (type) => {
        expect(user(type).canSignIn).toBe(true);
      },
    );

    it.each(['SUSPENDED', 'ANONYMIZED'] as const)(
      'never lets a %s account sign in',
      (status) => {
        expect(user('CUSTOMER', status).canSignIn).toBe(false);
      },
    );

    it('never lets an account without a password sign in', () => {
      const withoutPassword = User.restore({
        ...user('CUSTOMER').snapshot(),
        passwordHash: null,
      });

      expect(withoutPassword.canSignIn).toBe(false);
    });
  });
});

describe('User.changePassword (UC-IAM-09, BR-USR-09)', () => {
  it('replaces the hash, records when, and ends a pending temporary password', () => {
    const staff = User.restore({
      ...user('STAFF').snapshot(),
      mustChangePassword: true,
    });

    staff.changePassword('$argon2id$v=19$new', NOW);

    expect(staff.snapshot()).toMatchObject({
      passwordHash: '$argon2id$v=19$new',
      passwordChangedAt: NOW,
      mustChangePassword: false,
    });
    expect(staff.canSignIn).toBe(true);
  });

  it.each(['SUSPENDED', 'ANONYMIZED'] as const)(
    'never changes the password of a %s account',
    (status) => {
      expect(() =>
        user('CUSTOMER', status).changePassword('$argon2id$v=19$new', NOW),
      ).toThrow(InvalidStateTransitionError);
    },
  );
});

describe('normalizeEmail (BR-USR-01)', () => {
  it('compares emails in lowercase and without surrounding spaces', () => {
    expect(normalizeEmail('  Ana.Perez@Example.COM ')).toBe(
      'ana.perez@example.com',
    );
  });
});
