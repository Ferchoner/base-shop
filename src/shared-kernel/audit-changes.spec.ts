import {
  changesBetween,
  isAlwaysHiddenField,
  redactAuditChanges,
} from './audit-changes.js';
import { Money } from './money.js';

describe('changesBetween (ADR-0100)', () => {
  it('keeps only the fields that changed, with their old and new value', () => {
    expect(
      changesBetween(
        { status: 'PAID', total: 100, note: 'same' },
        { status: 'CANCELLED', total: 100, note: 'same' },
      ),
    ).toEqual({ status: { from: 'PAID', to: 'CANCELLED' } });
  });

  it('records fields that appear or disappear, as null on the missing side', () => {
    expect(changesBetween({ a: 1 }, { b: 2 })).toEqual({
      a: { from: 1, to: null },
      b: { from: null, to: 2 },
    });
  });

  it('stores values as JSON would send them', () => {
    expect(
      changesBetween(
        { price: Money.of(100, 'MXN'), publishedAt: null },
        {
          price: Money.of(200, 'MXN'),
          publishedAt: new Date('2026-09-27T12:00:00.000Z'),
        },
      ),
    ).toEqual({
      price: {
        from: { amount: 100, currency: 'MXN' },
        to: { amount: 200, currency: 'MXN' },
      },
      publishedAt: { from: null, to: '2026-09-27T12:00:00.000Z' },
    });
  });

  it('records only that a declared personal field changed', () => {
    expect(
      changesBetween(
        { contactName: 'Ana', status: 'ACTIVE' },
        { contactName: 'Luis', status: 'SUSPENDED' },
        { personal: ['contactName'] },
      ),
    ).toEqual({
      contactName: { changed: true },
      status: { from: 'ACTIVE', to: 'SUSPENDED' },
    });
  });

  it('hides always-hidden fields even when they are not declared', () => {
    expect(
      changesBetween(
        { email: 'ana@example.com', passwordHash: 'x', phone: '1' },
        { email: 'luis@example.com', passwordHash: 'y', phone: '2' },
      ),
    ).toEqual({
      email: { changed: true },
      passwordHash: { changed: true },
      phone: { changed: true },
    });
  });

  it('returns no changes for equal versions', () => {
    expect(changesBetween({ a: [1, 2] }, { a: [1, 2] })).toEqual({});
  });
});

describe('redactAuditChanges', () => {
  it('hides always-hidden fields in changes built by hand, including nested ones', () => {
    expect(
      redactAuditChanges({
        refreshToken: { from: 'a', to: 'b' },
        contact: {
          from: { email: 'ana@example.com', city: 'Morelia' },
          to: { email: 'luis@example.com', city: 'Uruapan' },
        },
        roles: { from: ['OPERATOR'], to: ['ADMIN'] },
      }),
    ).toEqual({
      refreshToken: { changed: true },
      contact: {
        from: { email: '[redacted]', city: 'Morelia' },
        to: { email: '[redacted]', city: 'Uruapan' },
      },
      roles: { from: ['OPERATOR'], to: ['ADMIN'] },
    });
  });
});

describe('isAlwaysHiddenField', () => {
  it.each([
    'password',
    'passwordHash',
    'refreshToken',
    'clientSecret',
    'contactEmail',
    'phone',
    'firstNames',
    'lastNames',
    'shippingAddress',
  ])('hides %s', (field) => {
    expect(isAlwaysHiddenField(field)).toBe(true);
  });

  it.each(['status', 'total', 'name', 'sku', 'roles'])('keeps %s', (field) => {
    expect(isAlwaysHiddenField(field)).toBe(false);
  });
});
