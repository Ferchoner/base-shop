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
import {
  CartNotActiveError,
  VariantNotSellableError,
} from '../domain/cart-errors.js';
import { CartRepository } from '../domain/cart.repository.js';
import {
  CartCatalog,
  CartPrices,
  CartStock,
  type CartVariant,
} from './cart-ports.js';
import type { CartCopies } from './cart-copies.js';
import { CartViews, EMPTY_CART } from './cart-views.js';
import { Carts } from './carts.use-case.js';
import type { CustomerCarts } from './customer-carts.js';
import { ShoppingFacade } from './shopping.facade.js';

// Test doubles of the unit tests of Shopping's application layer.

/** Carts in memory; it remembers which carts were saved. */
class InMemoryCarts extends CartRepository {
  readonly saved: CartId[] = [];
  private readonly carts = new Map<CartId, Cart>();

  constructor(...carts: Cart[]) {
    super();
    for (const cart of carts) this.carts.set(cart.id, cart);
  }

  get(id: CartId): Cart | undefined {
    return this.carts.get(id);
  }

  all(): Cart[] {
    return [...this.carts.values()];
  }

  find(id: CartId): Promise<Cart | null> {
    return Promise.resolve(this.carts.get(id) ?? null);
  }

  findActiveOf(customer: CustomerId): Promise<Cart | null> {
    return Promise.resolve(
      this.all().find(
        (cart) => cart.ownerId === customer && cart.status === 'ACTIVE',
      ) ?? null,
    );
  }

  lock(id: CartId): Promise<Cart | null> {
    return this.find(id);
  }

  lockActiveOf(customer: CustomerId): Promise<Cart | null> {
    return this.findActiveOf(customer);
  }

  insert(cart: Cart): Promise<void> {
    this.carts.set(cart.id, cart);
    return Promise.resolve();
  }

  save(cart: Cart): Promise<void> {
    this.saved.push(cart.id);
    this.carts.set(cart.id, cart);
    return Promise.resolve();
  }
}

/** A variant of a published product, on sale unless told otherwise. */
function cartVariant(
  id: VariantId,
  changes: Partial<CartVariant> = {},
): CartVariant {
  return {
    id,
    sku: `SKU-${id.slice(-4)}`,
    options: { talla: 'M' },
    product: { id: `product-${id}`, slug: `producto-${id}`, title: 'Camisa' },
    image: null,
    onSale: true,
    ...changes,
  };
}

/** Catalog, prices and stock in memory; each remembers what it was asked. */
function fakeContexts(
  variants: CartVariant[],
  prices: ReadonlyMap<VariantId, number>,
  available: ReadonlySet<VariantId> = new Set(),
) {
  const asked: {
    catalog: VariantId[][];
    prices: VariantId[][];
    stock: unknown[];
  } = {
    catalog: [],
    prices: [],
    stock: [],
  };
  const catalog = {
    variants: (ids: readonly VariantId[]) => {
      asked.catalog.push([...ids]);
      return Promise.resolve(
        new Map(
          variants.filter(({ id }) => ids.includes(id)).map((v) => [v.id, v]),
        ),
      );
    },
  } as unknown as CartCatalog;
  const pricing = {
    current: (ids: readonly VariantId[]) => {
      asked.prices.push([...ids]);
      return Promise.resolve(
        new Map(
          [...prices]
            .filter(([id]) => ids.includes(id))
            .map(([id, amount]) => [id, Money.of(amount, 'MXN')]),
        ),
      );
    },
  } as unknown as CartPrices;
  const stock = {
    canFulfill: (lines: readonly { variantId: VariantId }[]) => {
      asked.stock.push(lines.map((line) => ({ ...line })));
      return Promise.resolve(
        new Map(
          lines.map(({ variantId }) => [variantId, available.has(variantId)]),
        ),
      );
    },
  } as unknown as CartStock;
  return { catalog, pricing, stock, asked };
}

const inline = {
  run: <T>(work: () => Promise<T>) => work(),
} as unknown as TransactionManager;

const NOW = new Date('2026-10-01T12:00:00.000Z');
const BEFORE = new Date('2026-09-30T12:00:00.000Z');
const clock = { now: () => NOW };
const customer = newId<'User'>();
const [shirt, cap, draft, unpriced] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];
const variants = [
  cartVariant(shirt),
  cartVariant(cap),
  cartVariant(draft, { onSale: false }),
  cartVariant(unpriced),
];
const prices = new Map([
  [shirt, 59_900],
  [cap, 19_900],
  [draft, 100],
]);

function cart(
  changes: {
    owner?: CustomerId | null;
    status?: CartStatus;
    lines?: [VariantId, number][];
    mergedInto?: CartId | null;
  } = {},
): Cart {
  return Cart.restore({
    id: newId<'Cart'>(),
    ownerId: changes.owner ?? null,
    status: changes.status ?? 'ACTIVE',
    mergedIntoCartId: changes.mergedInto ?? null,
    lastActivityAt: BEFORE,
    version: 1,
    lines: (changes.lines ?? []).map(([variantId, quantity]) => ({
      variantId,
      quantity,
      addedAt: BEFORE,
    })),
  });
}

function setUp(...carts: Cart[]) {
  const repository = new InMemoryCarts(...carts);
  const contexts = fakeContexts(variants, prices, new Set([shirt]));
  const use = new Carts(
    repository,
    contexts.catalog,
    contexts.pricing,
    inline,
    clock,
  );
  const views = new CartViews(
    repository,
    contexts.catalog,
    contexts.pricing,
    contexts.stock,
    clock,
  );
  return { repository, use, views, asked: contexts.asked };
}

const quantities = (target: Cart | undefined) =>
  target?.lines.map(({ variantId, quantity }) => [variantId, quantity]);

describe('Carts (UC-CRT-01 to 04 and 06, ADR-0131)', () => {
  it('creates an empty guest cart with a random UUIDv4 (ADR-0059)', async () => {
    const { repository, use } = setUp();

    const id = await use.createGuestCart();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    expect(repository.get(id)).toMatchObject({
      ownerId: null,
      status: 'ACTIVE',
      lastActivityAt: NOW,
    });
  });

  describe('adding lines (UC-CRT-02)', () => {
    it('adds to a guest cart, and answers that it created nothing', async () => {
      const guest = cart();
      const { repository, use } = setUp(guest);

      expect(await use.addLine({ guestCartId: guest.id }, shirt, 2)).toEqual({
        cartId: guest.id,
        created: false,
      });
      expect(quantities(repository.get(guest.id))).toEqual([[shirt, 2]]);
      expect(repository.saved).toEqual([guest.id]);
    });

    it('opens the customer cart on the first line, and uses it afterwards', async () => {
      const { repository, use } = setUp();

      const first = await use.addLine({ customerId: customer }, shirt, 1);
      const second = await use.addLine({ customerId: customer }, cap, 1);

      expect(first.created).toBe(true);
      expect(second).toEqual({ cartId: first.cartId, created: false });
      expect(repository.get(first.cartId)?.ownerId).toBe(customer);
      expect(quantities(repository.get(first.cartId))).toEqual(
        expect.arrayContaining([
          [shirt, 1],
          [cap, 1],
        ]),
      );
    });

    it.each([
      ['unknown', () => newId<'Variant'>()],
      ['not on sale', () => draft],
      ['without a price', () => unpriced],
    ])(
      'rejects a variant %s the same way, before touching any cart',
      async (_case, which) => {
        const guest = cart();
        const { repository, use } = setUp(guest);
        const variantId = which();

        await expect(
          use.addLine({ guestCartId: guest.id }, variantId, 1),
        ).rejects.toThrow(new VariantNotSellableError([variantId]));
        await expect(
          use.addLine({ customerId: customer }, variantId, 1),
        ).rejects.toThrow(VariantNotSellableError);
        expect(repository.all()).toHaveLength(1);
        expect(repository.saved).toEqual([]);
      },
    );

    it('answers 404 for a guest cart that does not exist or has an owner', async () => {
      const owned = cart({ owner: customer });
      const { use } = setUp(owned);

      for (const guestCartId of [newId<'Cart'>(), owned.id]) {
        await expect(use.addLine({ guestCartId }, shirt, 1)).rejects.toThrow(
          NotFoundError,
        );
      }
    });
  });

  describe('changing and removing lines (UC-CRT-03 and 04)', () => {
    it('sets the units of a line, and saves only a change', async () => {
      const guest = cart({ lines: [[shirt, 2]] });
      const { repository, use } = setUp(guest);

      await use.changeLine({ guestCartId: guest.id }, shirt, 2);
      expect(repository.saved).toEqual([]);
      await use.changeLine({ guestCartId: guest.id }, shirt, 5);

      expect(quantities(repository.get(guest.id))).toEqual([[shirt, 5]]);
      expect(repository.saved).toEqual([guest.id]);
    });

    it('answers 404 for a missing line, or a customer without a cart', async () => {
      const guest = cart({ lines: [[shirt, 2]] });
      const { use } = setUp(guest);

      await expect(
        use.changeLine({ guestCartId: guest.id }, cap, 1),
      ).rejects.toThrow(NotFoundError);
      await expect(
        use.changeLine({ customerId: customer }, shirt, 1),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects a new quantity for a line that is no longer sellable, but removes it (ADR-0131)', async () => {
      const guest = cart({ lines: [[draft, 1]] });
      const { repository, use } = setUp(guest);

      await expect(
        use.changeLine({ guestCartId: guest.id }, draft, 2),
      ).rejects.toThrow(VariantNotSellableError);
      await use.removeLine({ guestCartId: guest.id }, draft);

      expect(repository.get(guest.id)?.lines).toEqual([]);
    });

    it('answers a cart that is not active before anything else', async () => {
      const used = cart({ status: 'CHECKED_OUT', lines: [[draft, 1]] });
      const { use } = setUp(used);

      for (const variantId of [draft, cap]) {
        await expect(
          use.changeLine({ guestCartId: used.id }, variantId, 2),
        ).rejects.toThrow(new CartNotActiveError('CHECKED_OUT'));
      }
    });

    it('removes nothing, and saves nothing, for a missing line or a customer without a cart', async () => {
      const guest = cart({ lines: [[shirt, 2]] });
      const { repository, use } = setUp(guest);

      await use.removeLine({ guestCartId: guest.id }, cap);
      await use.removeLine({ customerId: customer }, shirt);

      expect(repository.saved).toEqual([]);
      await expect(
        use.removeLine({ guestCartId: newId<'Cart'>() }, shirt),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('merging a guest cart (UC-CRT-06, ADR-0059)', () => {
    it('adds the guest lines to the customer cart, up to 30 each, and leaves the guest cart MERGED', async () => {
      const own = cart({ owner: customer, lines: [[shirt, 25]] });
      const guest = cart({
        lines: [
          [shirt, 10],
          [cap, 1],
        ],
      });
      const { repository, use } = setUp(own, guest);

      await use.merge(customer, guest.id);

      expect(quantities(repository.get(own.id))).toEqual([
        [shirt, 30],
        [cap, 1],
      ]);
      expect(repository.get(guest.id)).toMatchObject({
        status: 'MERGED',
        mergedIntoCartId: own.id,
      });
      expect(repository.saved).toEqual([own.id, guest.id]);
    });

    it('gives the guest cart to a customer without one', async () => {
      const guest = cart({ lines: [[shirt, 2]] });
      const { repository, use } = setUp(guest);

      await use.merge(customer, guest.id);

      expect(repository.get(guest.id)).toMatchObject({
        ownerId: customer,
        status: 'ACTIVE',
      });
      expect(repository.saved).toEqual([guest.id]);
    });

    it('changes nothing when the cart was merged before into this customer', async () => {
      const own = cart({ owner: customer, lines: [[shirt, 2]] });
      const merged = cart({ status: 'MERGED', mergedInto: own.id });
      const adopted = cart({ owner: customer });
      const first = setUp(own, merged);
      const second = setUp(adopted);

      await first.use.merge(customer, merged.id);
      await second.use.merge(customer, adopted.id);

      expect(first.repository.saved).toEqual([]);
      expect(second.repository.saved).toEqual([]);
    });

    it('answers 404 for a cart that does not exist or has another owner', async () => {
      const other = cart({ owner: newId<'User'>() });
      const { use } = setUp(other);

      for (const id of [newId<'Cart'>(), other.id]) {
        await expect(use.merge(customer, id)).rejects.toThrow(NotFoundError);
      }
    });

    it('answers cart-not-active for a cart merged into another account or used by an order', async () => {
      const elsewhere = cart({ owner: newId<'User'>() });
      const merged = cart({ status: 'MERGED', mergedInto: elsewhere.id });
      const ordered = cart({ status: 'CHECKED_OUT' });
      const ownOrdered = cart({ owner: customer, status: 'CHECKED_OUT' });
      const { use } = setUp(elsewhere, merged, ordered, ownOrdered);

      await expect(use.merge(customer, merged.id)).rejects.toThrow(
        new CartNotActiveError('MERGED'),
      );
      await expect(use.merge(customer, ordered.id)).rejects.toThrow(
        new CartNotActiveError('CHECKED_OUT'),
      );
      await expect(use.merge(customer, ownOrdered.id)).rejects.toThrow(
        new CartNotActiveError('CHECKED_OUT'),
      );
    });
  });
});

describe('CartViews (UC-CRT-05, BR-CRT-04, ADR-0061)', () => {
  it('prices each line now, keeps the lines that cannot be sold, and adds up only the sellable ones', async () => {
    const guest = cart({
      lines: [
        [shirt, 2],
        [cap, 1],
        [draft, 3],
        [unpriced, 4],
      ],
    });
    const { views, asked } = setUp(guest);

    const view = await views.guestCart(guest.id);

    expect(view).toMatchObject({
      id: guest.id,
      status: 'ACTIVE',
      itemCount: 10,
      subtotal: Money.of(139_700, 'MXN'),
      lastActivityAt: BEFORE,
    });
    expect(
      view.lines.map((line) => [
        line.variantId,
        line.sellable,
        line.canFulfill,
        line.unitPrice?.amount ?? null,
        line.lineTotal?.amount ?? null,
      ]),
    ).toEqual([
      [shirt, true, true, 59_900, 119_800],
      [cap, true, false, 19_900, 19_900],
      [draft, false, false, null, null],
      [unpriced, false, false, null, null],
    ]);
    expect(view.lines[0]).toMatchObject({
      quantity: 2,
      sku: variants[0].sku,
      options: { talla: 'M' },
      product: variants[0].product,
      image: null,
    });
    // Prices only for variants on sale, stock only for sellable lines (ADR-0061).
    expect(asked.prices).toEqual([[shirt, cap, unpriced]]);
    expect(asked.stock).toEqual([
      [
        { variantId: shirt, quantity: 2, addedAt: BEFORE },
        { variantId: cap, quantity: 1, addedAt: BEFORE },
      ],
    ]);
  });

  it('shows a merged or used guest cart with its status', async () => {
    const merged = cart({ status: 'MERGED', mergedInto: newId<'Cart'>() });
    const { views } = setUp(merged);

    expect((await views.guestCart(merged.id)).status).toBe('MERGED');
  });

  it('answers 404 for a guest cart that does not exist or has an owner', async () => {
    const owned = cart({ owner: customer });
    const { views } = setUp(owned);

    for (const id of [newId<'Cart'>(), owned.id]) {
      await expect(views.guestCart(id)).rejects.toThrow(NotFoundError);
    }
  });

  it('shows the active cart of the customer, or an empty one with no id', async () => {
    const own = cart({ owner: customer, lines: [[cap, 1]] });
    const { views } = setUp(own);

    expect((await views.customerCart(customer)).id).toBe(own.id);
    expect(await views.customerCart(newId<'User'>())).toBe(EMPTY_CART);
    expect(EMPTY_CART).toEqual({
      id: null,
      status: 'ACTIVE',
      lines: [],
      itemCount: 0,
      subtotal: Money.zero('MXN'),
      lastActivityAt: null,
    });
  });
});

describe('ShoppingFacade, for the checkout (UC-ORD-01 and 02, ADR-0132)', () => {
  function facade(...carts: Cart[]) {
    const repository = new InMemoryCarts(...carts);
    return {
      repository,
      shopping: new ShoppingFacade(
        repository,
        {} as unknown as CartCopies,
        inline,
        clock,
        {} as unknown as CustomerCarts,
      ),
    };
  }

  it('gives the variants and units of an active cart, oldest first, without prices', async () => {
    const guest = Cart.restore({
      id: newId<'Cart'>(),
      ownerId: null,
      status: 'ACTIVE',
      mergedIntoCartId: null,
      lastActivityAt: BEFORE,
      version: 1,
      lines: [
        { variantId: cap, quantity: 1, addedAt: NOW },
        { variantId: shirt, quantity: 2, addedAt: BEFORE },
      ],
    });
    const own = cart({ owner: customer, lines: [[cap, 3]] });
    const { shopping } = facade(guest, own);

    const expected = {
      id: guest.id,
      lines: [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
      ],
    };
    expect(await shopping.cartToQuote({ guestCartId: guest.id })).toEqual(
      expected,
    );
    expect(await shopping.lockCartToOrder({ guestCartId: guest.id })).toEqual(
      expected,
    );
    expect(await shopping.cartToQuote({ customerId: customer })).toEqual({
      id: own.id,
      lines: [{ variantId: cap, quantity: 3 }],
    });
  });

  it('answers null for a customer without an active cart', async () => {
    const used = cart({ owner: customer, status: 'CHECKED_OUT' });
    const { shopping } = facade(used);

    expect(await shopping.cartToQuote({ customerId: customer })).toBeNull();
    expect(await shopping.lockCartToOrder({ customerId: customer })).toBeNull();
  });

  it('answers 404 for a guest cart that does not exist or has an owner, and 409 for one not active', async () => {
    const owned = cart({ owner: customer });
    const used = cart({ status: 'CHECKED_OUT' });
    const merged = cart({ status: 'MERGED', mergedInto: owned.id });
    const { shopping } = facade(owned, used, merged);

    for (const read of [
      (id: CartId) => shopping.cartToQuote({ guestCartId: id }),
      (id: CartId) => shopping.lockCartToOrder({ guestCartId: id }),
    ]) {
      await expect(read(newId<'Cart'>())).rejects.toThrow(NotFoundError);
      await expect(read(owned.id)).rejects.toThrow(NotFoundError);
      await expect(read(used.id)).rejects.toThrow(
        new CartNotActiveError('CHECKED_OUT'),
      );
      await expect(read(merged.id)).rejects.toThrow(
        new CartNotActiveError('MERGED'),
      );
    }
  });

  it('checks the cart out and saves it, only while it is active', async () => {
    const guest = cart({ lines: [[shirt, 2]] });
    const { repository, shopping } = facade(guest);

    await shopping.checkOut(guest.id);

    expect(repository.get(guest.id)).toMatchObject({
      status: 'CHECKED_OUT',
      lastActivityAt: NOW,
    });
    expect(repository.saved).toEqual([guest.id]);
    await expect(shopping.checkOut(guest.id)).rejects.toThrow(
      new CartNotActiveError('CHECKED_OUT'),
    );
    await expect(shopping.checkOut(newId<'Cart'>())).rejects.toThrow(
      NotFoundError,
    );
  });
});
