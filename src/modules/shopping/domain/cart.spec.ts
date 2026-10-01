import { InvalidValueError, newId } from '../../../shared-kernel/index.js';
import {
  Cart,
  type CartStatus,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  type VariantId,
} from './cart.js';
import {
  CartLineLimitError,
  CartNotActiveError,
  LineQuantityError,
} from './cart-errors.js';

const T0 = new Date('2026-10-01T12:00:00.000Z');
const T1 = new Date('2026-10-01T12:01:00.000Z');
const T2 = new Date('2026-10-01T12:02:00.000Z');
const variant = () => newId<'Variant'>();
const customer = newId<'User'>();

const restored = (
  status: CartStatus,
  lines: { variantId: VariantId; quantity: number }[] = [],
  ownerId: typeof customer | null = null,
) =>
  Cart.restore({
    id: newId<'Cart'>(),
    ownerId,
    status,
    mergedIntoCartId: status === 'MERGED' ? newId<'Cart'>() : null,
    lastActivityAt: T0,
    version: 3,
    lines: lines.map((line) => ({ ...line, addedAt: T0 })),
  });

describe('Cart (BR-CRT-01 to 05, ADR-0059, ADR-0131)', () => {
  it('opens empty and active, for a guest or a customer', () => {
    const guest = Cart.open(newId<'Cart'>(), null, T0);
    const own = Cart.open(newId<'Cart'>(), customer, T0);

    expect([guest.status, guest.ownerId, guest.lines]).toEqual([
      'ACTIVE',
      null,
      [],
    ]);
    expect(own.ownerId).toBe(customer);
    expect(guest.lastActivityAt).toBe(T0);
    expect(guest.hasChanges).toBe(true);
  });

  it('keeps one line per variant, adding units to it (BR-CRT-01)', () => {
    const cart = restored('ACTIVE');
    const shirt = variant();

    cart.add(shirt, 2, T1);
    cart.add(shirt, 3, T2);

    expect(cart.lines).toEqual([
      { variantId: shirt, quantity: 5, addedAt: T1 },
    ]);
    expect(cart.lastActivityAt).toBe(T2);
    expect(cart.touchedVariants).toEqual([shirt]);
  });

  it('shows its lines oldest first, then by variant', () => {
    const [a, b, c] = [variant(), variant(), variant()].sort();
    const cart = restored('ACTIVE');

    cart.add(c, 1, T1);
    cart.add(b, 1, T2);
    cart.add(a, 1, T1);

    expect(cart.lines.map(({ variantId }) => variantId)).toEqual([a, c, b]);
  });

  it('holds from 1 to 30 units per line (BR-CRT-02)', () => {
    const shirt = variant();
    const cart = restored('ACTIVE', [{ variantId: shirt, quantity: 25 }]);

    expect(() => cart.add(shirt, 6, T1)).toThrow(LineQuantityError);
    expect(() => cart.add(variant(), MAX_LINE_QUANTITY + 1, T1)).toThrow(
      LineQuantityError,
    );
    expect(() => cart.add(variant(), 0, T1)).toThrow(InvalidValueError);
    expect(() => cart.add(variant(), 1.5, T1)).toThrow(InvalidValueError);
    cart.add(shirt, 5, T1);
    expect(cart.line(shirt)?.quantity).toBe(30);
  });

  it('answers the limit of units as a validation error of quantity', () => {
    expect(new LineQuantityError(30)).toMatchObject({
      code: 'validation-error',
      details: { errors: [{ field: 'quantity', code: 'lineQuantity' }] },
    });
  });

  it('holds at most MAX_CART_LINES different variants, and still adds units to them (ADR-0131)', () => {
    const lines = Array.from({ length: MAX_CART_LINES }, () => ({
      variantId: variant(),
      quantity: 1,
    }));
    const cart = restored('ACTIVE', lines);

    expect(() => cart.add(variant(), 1, T1)).toThrow(
      new CartLineLimitError(MAX_CART_LINES),
    );
    cart.add(lines[0].variantId, 1, T1);
    expect(cart.line(lines[0].variantId)?.quantity).toBe(2);
    expect(MAX_CART_LINES).toBe(100);
  });

  it('sets the units of a line it has, and changes nothing for the same units or a missing line', () => {
    const shirt = variant();
    const cart = restored('ACTIVE', [{ variantId: shirt, quantity: 2 }]);

    expect(cart.change(variant(), 3, T1)).toBe(false);
    expect(cart.change(shirt, 2, T1)).toBe(true);
    expect(cart.hasChanges).toBe(false);
    expect(cart.change(shirt, 7, T1)).toBe(true);
    expect(cart.line(shirt)).toEqual({
      variantId: shirt,
      quantity: 7,
      addedAt: T0,
    });
    expect(cart.lastActivityAt).toBe(T1);
    expect(() => cart.change(shirt, 31, T1)).toThrow(LineQuantityError);
  });

  it('removes a line, and removing a missing one changes nothing', () => {
    const shirt = variant();
    const cart = restored('ACTIVE', [{ variantId: shirt, quantity: 2 }]);

    cart.remove(variant(), T1);
    expect(cart.hasChanges).toBe(false);
    cart.remove(shirt, T1);

    expect(cart.lines).toEqual([]);
    expect(cart.touchedVariants).toEqual([shirt]);
    expect(cart.lastActivityAt).toBe(T1);
  });

  it.each(['CHECKED_OUT', 'MERGED'] as const)(
    'changes nothing once %s (BR-CRT-03)',
    (status) => {
      const shirt = variant();
      const cart = restored(status, [{ variantId: shirt, quantity: 1 }]);
      const notActive = new CartNotActiveError(status);

      expect(() => cart.add(shirt, 1, T1)).toThrow(notActive);
      expect(() => cart.change(shirt, 2, T1)).toThrow(notActive);
      expect(() => cart.remove(shirt, T1)).toThrow(notActive);
      expect(() => cart.adoptBy(customer, T1)).toThrow(notActive);
      expect(() => restored('ACTIVE').absorb(cart, T1)).toThrow(notActive);
      expect(() => cart.absorb(restored('ACTIVE'), T1)).toThrow(notActive);
      expect(notActive.details).toEqual({ cartStatus: status });
    },
  );

  it('absorbs a guest cart: units add up to 30 without notice, and the guest cart is MERGED into it (BR-CRT-05)', () => {
    const [shirt, cap, hat] = [variant(), variant(), variant()];
    const own = restored(
      'ACTIVE',
      [
        { variantId: shirt, quantity: 20 },
        { variantId: cap, quantity: 30 },
      ],
      customer,
    );
    const guest = restored('ACTIVE', [
      { variantId: shirt, quantity: 15 },
      { variantId: cap, quantity: 1 },
      { variantId: hat, quantity: 2 },
    ]);

    own.absorb(guest, T1);

    expect(
      own.lines.map(({ variantId, quantity }) => [variantId, quantity]),
    ).toEqual(
      expect.arrayContaining([
        [shirt, 30],
        [cap, 30],
        [hat, 2],
      ]),
    );
    expect(own.touchedVariants.sort()).toEqual([shirt, hat].sort());
    expect([guest.status, guest.mergedIntoCartId]).toEqual(['MERGED', own.id]);
    expect([own.lastActivityAt, guest.lastActivityAt]).toEqual([T1, T1]);
    expect(guest.hasChanges).toBe(true);
  });

  it('never drops what a guest cart brings, even past MAX_CART_LINES', () => {
    const many = () =>
      Array.from({ length: 60 }, () => ({ variantId: variant(), quantity: 1 }));
    const own = restored('ACTIVE', many(), customer);

    own.absorb(restored('ACTIVE', many()), T1);

    expect(own.lines).toHaveLength(120);
  });

  it('becomes the customer’s cart, with its lines as they are, when adopted (ADR-0059)', () => {
    const shirt = variant();
    const guest = restored('ACTIVE', [{ variantId: shirt, quantity: 2 }]);

    guest.adoptBy(customer, T1);

    expect([guest.ownerId, guest.status, guest.lastActivityAt]).toEqual([
      customer,
      'ACTIVE',
      T1,
    ]);
    expect(guest.touchedVariants).toEqual([]);
  });

  it('keeps what was saved until something changes', () => {
    const cart = restored('ACTIVE');

    expect([cart.hasChanges, cart.version, cart.lastActivityAt]).toEqual([
      false,
      3,
      T0,
    ]);
  });
});
