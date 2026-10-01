import {
  newId,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  Cart,
  type CartId,
  type CartStatus,
  type CustomerId,
} from '../domain/cart.js';
import { CartRepository } from '../domain/cart.repository.js';
import { CartRestoration } from './cart-restoration.use-case.js';

// Test doubles of the unit tests of the restoration of carts.

const CHECKED_OUT_AT = new Date('2026-10-01T12:00:00.000Z');
const EXPIRED = new Date('2026-10-01T12:21:00.000Z');
const NOW = new Date('2026-10-01T12:21:05.000Z');
const [shirt, cap] = [newId<'Variant'>(), newId<'Variant'>()];
const customer = newId<'User'>();

/** A saved cart; its last change is the checkout unless told otherwise. */
const saved = (
  status: CartStatus,
  ownerId: CustomerId | null,
  lines: { variantId: typeof shirt; quantity: number }[] = [],
  lastActivityAt = CHECKED_OUT_AT,
) =>
  Cart.restore({
    id: newId<'Cart'>(),
    ownerId,
    status,
    mergedIntoCartId: null,
    lastActivityAt,
    version: 2,
    lines: lines.map((line) => ({ ...line, addedAt: CHECKED_OUT_AT })),
  });

/** Carts in memory; it remembers what it locked, in order, and what it saved. */
class InMemoryCarts extends CartRepository {
  readonly saved: CartId[] = [];
  readonly locked: string[] = [];
  private readonly carts = new Map<CartId, Cart>();

  constructor(...carts: Cart[]) {
    super();
    for (const cart of carts) this.carts.set(cart.id, cart);
  }

  find(): Promise<Cart | null> {
    throw new Error('Restoring locks what it reads');
  }

  findActiveOf(): Promise<Cart | null> {
    throw new Error('Restoring locks what it reads');
  }

  lock(id: CartId): Promise<Cart | null> {
    this.locked.push(`cart ${id}`);
    return Promise.resolve(this.carts.get(id) ?? null);
  }

  lockActiveOf(owner: CustomerId): Promise<Cart | null> {
    this.locked.push(`customer ${owner}`);
    return Promise.resolve(
      [...this.carts.values()].find(
        (cart) => cart.ownerId === owner && cart.status === 'ACTIVE',
      ) ?? null,
    );
  }

  insert(): Promise<void> {
    throw new Error('Restoring never opens a cart');
  }

  save(cart: Cart): Promise<void> {
    this.saved.push(cart.id);
    return Promise.resolve();
  }
}

function setUp(...carts: Cart[]) {
  const repository = new InMemoryCarts(...carts);
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const restoration = new CartRestoration(repository, inline, {
    now: () => NOW,
  });
  return { restoration, carts: repository };
}

const order = (
  source: Cart | CartId,
  customerId: CustomerId | null,
  lines = [{ variantId: shirt, quantity: 2 }],
) => ({
  customerId,
  sourceCartId: typeof source === 'string' ? source : source.id,
  lines,
  expiredAt: EXPIRED,
});

describe('CartRestoration (UC-CRT-08, ADR-0054, ADR-0137)', () => {
  it('gives a guest the cart of the order back, active again', async () => {
    const source = saved('CHECKED_OUT', null, [
      { variantId: shirt, quantity: 2 },
    ]);
    const { restoration, carts } = setUp(source);

    expect(await restoration.restoreExpiredOrder(order(source, null))).toBe(
      'reactivated',
    );

    expect([source.status, source.lastActivityAt]).toEqual(['ACTIVE', NOW]);
    expect(carts.locked).toEqual([`cart ${source.id}`]);
    expect(carts.saved).toEqual([source.id]);
  });

  it('gives a customer without an active cart the cart of the order back, locking the customer first', async () => {
    const source = saved('CHECKED_OUT', customer);
    const { restoration, carts } = setUp(source);

    expect(await restoration.restoreExpiredOrder(order(source, customer))).toBe(
      'reactivated',
    );

    expect(source.status).toBe('ACTIVE');
    expect(carts.locked).toEqual([`customer ${customer}`, `cart ${source.id}`]);
  });

  it('puts the lines of the order in the customer’s active cart, and merges the cart of the order into it', async () => {
    const own = saved('ACTIVE', customer, [{ variantId: shirt, quantity: 29 }]);
    const source = saved('CHECKED_OUT', customer);
    const { restoration, carts } = setUp(own, source);

    expect(
      await restoration.restoreExpiredOrder(
        order(source, customer, [
          { variantId: shirt, quantity: 2 },
          { variantId: cap, quantity: 1 },
        ]),
      ),
    ).toBe('merged');

    expect(
      own.lines.map(({ variantId, quantity }) => [variantId, quantity]),
    ).toEqual([
      [shirt, 30],
      [cap, 1],
    ]);
    expect([source.status, source.mergedIntoCartId]).toEqual([
      'MERGED',
      own.id,
    ]);
    expect(carts.saved).toEqual([own.id, source.id]);
  });

  it('changes nothing for a repeated event, or one that arrives after the cart was used again', async () => {
    for (const source of [
      saved('ACTIVE', null),
      saved('MERGED', customer),
      // The buyer used the cart for another order after this one expired.
      saved('CHECKED_OUT', null, [], new Date(EXPIRED.getTime() + 1)),
    ]) {
      const { restoration, carts } = setUp(source);

      expect(
        await restoration.restoreExpiredOrder(order(source, source.ownerId)),
      ).toBe('already-restored');
      expect(carts.saved).toEqual([]);
    }
  });

  it('restores a cart whose last change is exactly when the order expired', async () => {
    const source = saved('CHECKED_OUT', null, [], EXPIRED);

    expect(
      await setUp(source).restoration.restoreExpiredOrder(order(source, null)),
    ).toBe('reactivated');
  });

  it('changes nothing when the cart of the order does not exist or is not its buyer’s', async () => {
    const ofGuest = saved('CHECKED_OUT', null);
    const ofCustomer = saved('CHECKED_OUT', customer);
    for (const [source, buyer] of [
      [newId<'Cart'>(), null],
      [ofGuest, customer],
      [ofCustomer, null],
      [ofCustomer, newId<'User'>()],
    ] as const) {
      const { restoration, carts } = setUp(ofGuest, ofCustomer);

      expect(await restoration.restoreExpiredOrder(order(source, buyer))).toBe(
        'unexpected',
      );
      expect(carts.saved).toEqual([]);
    }
    expect([ofGuest.status, ofCustomer.status]).toEqual([
      'CHECKED_OUT',
      'CHECKED_OUT',
    ]);
  });
});
