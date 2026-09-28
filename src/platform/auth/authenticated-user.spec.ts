import { authenticatedUserOf } from './authenticated-user.js';

const STAFF = {
  id: '01a0ea00-0000-7000-8000-000000000001',
  type: 'STAFF',
  permissions: ['customers.read'],
  mustChangePassword: false,
};

describe('authenticatedUserOf (ADR-0111)', () => {
  it('reads a well-formed user', () => {
    expect(authenticatedUserOf({ user: STAFF })).toEqual(STAFF);
  });

  it('treats a missing user as signed out', () => {
    expect(authenticatedUserOf({})).toBeUndefined();
  });

  it.each([
    ['no id', { ...STAFF, id: undefined }],
    ['an unknown account type', { ...STAFF, type: 'ADMIN' }],
    ['a permission outside the catalog', { ...STAFF, permissions: ['all'] }],
    ['no permission list', { ...STAFF, permissions: 'customers.read' }],
    ['no mustChangePassword', { ...STAFF, mustChangePassword: undefined }],
    ['not an object', 'user-1'],
  ])('treats a user with %s as signed out', (_, user) => {
    expect(authenticatedUserOf({ user })).toBeUndefined();
  });
});
