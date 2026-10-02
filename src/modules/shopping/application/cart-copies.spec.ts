import {
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  Cart,
  type CartId,
  type CartStatus,
  type CustomerId,
  type VariantId,
} from '../domain/cart.js';
import { CartNotActiveError } from '../domain/cart-errors.js';
import { CartRepository } from '../domain/cart.repository.js';
import { CartCopies } from './cart-copies.js';
import type { CartCatalog, CartPrices, CartVariant } from './cart-ports.js';

// Test doubles of the unit tests of copying an order into a cart.

const BEFORE = new Date('2026-10-01T12:00:00.000Z');
const NOW = new Date('2026-10-01T13:00:00.000Z');
const customer = newId<'User'>();
/** On sale and priced; off sale; on sale without a price. */
const [shirt, retired, unpriced] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];
const ORDER = [
  { variantId: shirt, quantity: 2 },
  { variantId: retired, quantity: 1 },
  { variantId: unpriced, quantity: 1 },
];

const saved = (
  status: CartStatus,
  ownerId: CustomerId | null,
  lines: { variantId: VariantId; quantity: number }[] = [],
) =>
  Cart.restore({
    id: newId<'Cart'>(),
    ownerId,
    status,
    mergedIntoCartId: status === 'MERGED' ? newId<'Cart'>() : null,
    lastActivityAt: BEFORE,
    version: 1,
    lines: lines.map((line) => ({ ...line, addedAt: BEFORE })),
  });

/** Carts in memory; it remembers what it inserted and saved. */
class InMemoryCarts extends CartRepository {
  readonly inserted: Cart[] = [];
  readonly saved: CartId[] = [];
  private readonly carts = new Map<CartId, Cart>();

  constructor(...carts: Cart[]) {
    super();
    for (const cart of carts) this.carts.set(cart.id, cart);
  }

  find(): Promise<Cart | null> {
    throw new Error('Copying locks what it reads');
  }

  findActiveOf(): Promise<Cart | null> {
    throw new Error('Copying locks what it reads');
  }

  lock(id: CartId): Promise<Cart | null> {
    return Promise.resolve(this.carts.get(id) ?? null);
  }

  lockActiveOf(owner: CustomerId): Promise<Cart | null> {
    return Promise.resolve(
      [...this.carts.values()].find(
        (cart) => cart.ownerId === owner && cart.status === 'ACTIVE',
      ) ?? null,
    );
  }

  insert(cart: Cart, now: Date): Promise<void> {
    expect(now).toBe(NOW);
    this.inserted.push(cart);
    this.carts.set(cart.id, cart);
    return Promise.resolve();
  }

  save(cart: Cart): Promise<void> {
    this.saved.push(cart.id);
    return Promise.resolve();
  }
}

function setUp(...carts: Cart[]) {
  const repository = new InMemoryCarts(...carts);
  const catalog = {
    variants: (ids: readonly VariantId[]) =>
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            { id, onSale: id !== retired } as unknown as CartVariant,
          ]),
        ),
      ),
  } as unknown as CartCatalog;
  const prices = {
    current: (ids: readonly VariantId[], at: Date) => {
      expect(at).toBe(NOW);
      return Promise.resolve(
        new Map(
          ids
            .filter((id) => id !== unpriced)
            .map((id) => [id, Money.of(10_000, 'MXN')]),
        ),
      );
    },
  } as unknown as CartPrices;
  const inline = {
    run: <T>(work: () => Promise<T>) => work(),
  } as unknown as TransactionManager;
  const copies = new CartCopies(repository, catalog, prices, inline, {
    now: () => NOW,
  });
  return { copies, carts: repository };
}

const quantities = (cart: Cart) =>
  cart.lines.map(({ variantId, quantity }) => [variantId, quantity]);

describe('CartCopies (UC-CRT-09, ADR-0139)', () => {
  it('copies the variants sold now into the customer’s active cart, and reports the rest', async () => {
    const own = saved('ACTIVE', customer, [{ variantId: shirt, quantity: 29 }]);
    const { copies, carts } = setUp(own);

    expect(await copies.toCustomerCart(customer, ORDER)).toEqual({
      cartId: own.id,
      skippedVariantIds: [retired, unpriced],
    });

    expect(quantities(own)).toEqual([[shirt, 30]]);
    expect([carts.inserted, carts.saved]).toEqual([[], [own.id]]);
  });

  it('opens a cart for a customer without one', async () => {
    const { copies, carts } = setUp();

    const { cartId } = await copies.toCustomerCart(customer, ORDER);

    const [opened] = carts.inserted;
    expect([opened.id, opened.ownerId, opened.status]).toEqual([
      cartId,
      customer,
      'ACTIVE',
    ]);
    expect(quantities(opened)).toEqual([[shirt, 2]]);
    expect(carts.saved).toEqual([cartId]);
  });

  it('copies into the active guest cart given, or opens one without owner', async () => {
    const guest = saved('ACTIVE', null);
    const given = setUp(guest);
    const none = setUp();

    expect((await given.copies.toGuestCart(guest.id, ORDER)).cartId).toBe(
      guest.id,
    );
    const { cartId } = await none.copies.toGuestCart(null, ORDER);

    expect(quantities(guest)).toEqual([[shirt, 2]]);
    const [opened] = none.carts.inserted;
    expect([opened.id, opened.ownerId, quantities(opened)]).toEqual([
      cartId,
      null,
      [[shirt, 2]],
    ]);
  });

  it('answers a guest cart that does not exist or has an owner as missing, and one not active as such', async () => {
    const owned = saved('ACTIVE', customer);
    const checkedOut = saved('CHECKED_OUT', null);
    const { copies, carts } = setUp(owned, checkedOut);

    for (const id of [newId<'Cart'>(), owned.id]) {
      await expect(copies.toGuestCart(id, ORDER)).rejects.toThrow(
        NotFoundError,
      );
    }
    await expect(copies.toGuestCart(checkedOut.id, ORDER)).rejects.toThrow(
      new CartNotActiveError('CHECKED_OUT'),
    );
    expect(carts.saved).toEqual([]);
  });

  it('reopens the checked out cart of a guest order with only the lines sold now, or adds them to it when active', async () => {
    const checkedOut = saved('CHECKED_OUT', null, ORDER);
    const active = saved('ACTIVE', null, [{ variantId: shirt, quantity: 2 }]);
    const { copies, carts } = setUp(checkedOut, active);

    expect(await copies.toSourceCart(checkedOut.id, ORDER)).toEqual({
      cartId: checkedOut.id,
      skippedVariantIds: [retired, unpriced],
    });
    expect((await copies.toSourceCart(active.id, ORDER))?.cartId).toBe(
      active.id,
    );

    expect([checkedOut.status, quantities(checkedOut)]).toEqual([
      'ACTIVE',
      [[shirt, 2]],
    ]);
    expect(quantities(active)).toEqual([[shirt, 4]]);
    expect(carts.saved).toEqual([checkedOut.id, active.id]);
  });

  it('answers null for a cart of the order that no longer exists or is no longer the guest’s', async () => {
    const owned = saved('CHECKED_OUT', customer);
    const merged = saved('MERGED', null);
    const { copies, carts } = setUp(owned, merged);

    for (const id of [newId<'Cart'>(), owned.id, merged.id]) {
      expect(await copies.toSourceCart(id, ORDER)).toBeNull();
    }
    expect(carts.saved).toEqual([]);
  });
});
