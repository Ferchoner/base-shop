import {
  type DomainEvent,
  type DomainEventPublisher,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  CartId,
  CustomerId,
  Order,
  OrderId,
  ShippingAddress,
  VariantId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import {
  CouponNotApplicableError,
  EmailNotVerifiedError,
  EmptyCartError,
  InvalidShippingAddressError,
  type LocationProblem,
  TotalMismatchError,
  VariantNotSellableError,
} from '../domain/ordering-errors.js';
import {
  type CheckoutCart,
  type CheckoutCarts,
  type CheckoutCatalog,
  type CheckoutCustomers,
  type CheckoutPrices,
  type CheckoutPromotions,
  type OrderDiscount,
  type CheckoutShipping,
  type CheckoutTarget,
  type CheckoutVariant,
  type LocationNames,
  type OrderStock,
  type ShippingCharge,
  type ShippingLocations,
  type StockLine,
} from './checkout-ports.js';
import {
  type AddressInput,
  Checkout,
  type CustomerOrderInput,
  type GuestOrderInput,
} from './checkout.use-case.js';

// Test doubles of the unit tests of Ordering's checkout.

const NOW = new Date('2026-10-01T12:00:00.000Z');
const DUE = new Date('2026-10-01T12:20:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');

const ADDRESS: AddressInput = {
  recipientName: 'María López',
  phone: '4431234567',
  street: 'Av. Madero',
  exteriorNumber: '123',
  interiorNumber: '4B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: null,
};

const SAVED: ShippingAddress = {
  ...ADDRESS,
  street: 'Calle Guardada',
  stateName: 'Michoacán de Ocampo',
  municipalityName: 'Morelia',
  country: 'MX',
};

const [shirt, cap, draft, unpriced, service] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];

const variant = (
  id: VariantId,
  onSale = true,
  storeOnly = false,
): CheckoutVariant => ({
  id,
  sku: `SKU-${id.slice(-4)}`,
  productName: 'Camisa de lino',
  options: { talla: 'M' },
  onSale,
  storeOnly,
});

/**
 * Orders in memory; the first `taken` inserts find their public code taken, and the contact emails in `couponUsers`
 * used the coupon already.
 */
class InMemoryOrders extends OrderRepository {
  readonly saved: Order[] = [];
  readonly tried: Order[] = [];
  readonly couponAsks: [string, string][] = [];

  constructor(
    private taken = 0,
    private readonly couponUsers: readonly string[] = [],
  ) {
    super();
  }

  usedCoupon(promotionId: string, contactEmail: string): Promise<boolean> {
    this.couponAsks.push([promotionId, contactEmail]);
    return Promise.resolve(this.couponUsers.includes(contactEmail));
  }

  insert(order: Order): Promise<boolean> {
    this.tried.push(order);
    if (this.taken > 0) {
      this.taken -= 1;
      return Promise.resolve(false);
    }
    this.saved.push(order);
    return Promise.resolve(true);
  }

  lock(): Promise<Order | null> {
    throw new Error('The checkout never locks a saved order');
  }

  lockByPublicCode(): Promise<Order | null> {
    throw new Error('The checkout never locks a saved order');
  }

  dueForBlocking(): Promise<OrderId[]> {
    throw new Error('This test never blocks orders');
  }

  dueForAnonymization(): Promise<OrderId[]> {
    throw new Error('This test never anonymizes orders by their date');
  }

  dueForExpiry(): Promise<OrderId[]> {
    throw new Error('The checkout never expires orders');
  }

  lockOf(): Promise<Order[]> {
    throw new Error('The checkout never anonymizes orders');
  }

  save(): Promise<void> {
    throw new Error('The checkout never saves a placed order again');
  }
}

/** Every port of the checkout in memory; `calls` records, in order, what the checkout asked. */
function setUp(
  options: {
    carts?: Map<string, CheckoutCart>;
    available?: ReadonlySet<VariantId>;
    contact?: { email: string; emailVerified: boolean } | null;
    location?: LocationNames | LocationProblem;
    shortOf?: VariantId[];
    taken?: number;
    freeShipping?: boolean;
    /** What Promotions answers for the lines that can be sold. */
    discount?: OrderDiscount | null;
    /** What Promotions answers for a coupon; by default, that none has the code. */
    coupon?: Awaited<ReturnType<CheckoutPromotions['couponFor']>>;
    /** Whether the coupon has a use left. */
    redeemable?: boolean;
    /** The contact emails that used the coupon already. */
    couponUsers?: string[];
  } = {},
) {
  const calls: string[] = [];
  const reserved: { orderId: OrderId; lines: StockLine[] }[] = [];
  const checkedOut: CartId[] = [];
  const asked: { prices: VariantId[][]; stock: StockLine[][] } = {
    prices: [],
    stock: [],
  };
  const cartOf = (target: CheckoutTarget) =>
    options.carts?.get(
      'customerId' in target ? target.customerId : target.guestCartId,
    ) ?? null;
  const carts: CheckoutCarts = {
    toQuote: (target) => {
      calls.push('toQuote');
      return Promise.resolve(cartOf(target));
    },
    lockToOrder: (target) => {
      calls.push('lockToOrder');
      return Promise.resolve(cartOf(target));
    },
    checkOut: (id) => {
      calls.push('checkOut');
      checkedOut.push(id);
      return Promise.resolve();
    },
  };
  const catalog: CheckoutCatalog = {
    variants: (ids) =>
      Promise.resolve(
        new Map(
          [
            variant(shirt),
            variant(cap),
            variant(draft, false),
            variant(unpriced),
            // Published, active and priced, but sold only in the store (ADR-0165).
            variant(service, true, true),
          ]
            .filter(({ id }) => ids.includes(id))
            .map((v) => [v.id, v]),
        ),
      ),
  };
  const prices: CheckoutPrices = {
    current: (ids, at) => {
      expect(at).toBe(NOW);
      asked.prices.push([...ids]);
      return Promise.resolve(
        new Map(
          (
            [
              [shirt, 59_900],
              [cap, 19_900],
              [draft, 100],
              [service, 25_000],
            ] as const
          )
            .filter(([id]) => ids.includes(id))
            .map(([id, amount]) => [id, mxn(amount)]),
        ),
      );
    },
  };
  const promotionAsks: Parameters<CheckoutPromotions['discountFor']>[0][] = [];
  const couponAsks: Parameters<CheckoutPromotions['couponFor']>[0][] = [];
  const redeemed: string[] = [];
  const promotions: CheckoutPromotions = {
    discountFor: (input) => {
      calls.push('promotions');
      promotionAsks.push(input);
      return Promise.resolve(options.discount ?? null);
    },
    couponFor: (input) => {
      calls.push('coupon');
      couponAsks.push(input);
      return Promise.resolve(options.coupon ?? { refused: 'unavailable' });
    },
    redeem: (promotionId) => {
      calls.push('redeem');
      redeemed.push(promotionId);
      return Promise.resolve(options.redeemable ?? true);
    },
  };
  const stock: OrderStock = {
    canFulfill: (lines) => {
      asked.stock.push(lines.map((line) => ({ ...line })));
      return Promise.resolve(
        new Map(
          lines.map(({ variantId }) => [
            variantId,
            (options.available ?? new Set([shirt, cap])).has(variantId),
          ]),
        ),
      );
    },
    reserve: (orderId, lines) => {
      calls.push('reserve');
      const short = options.shortOf ?? [];
      if (short.length > 0) {
        return Promise.reject(new Error(`short of ${short.join(',')}`));
      }
      reserved.push({ orderId, lines: lines.map((line) => ({ ...line })) });
      return Promise.resolve({ id: newId<'Reservation'>(), expiresAt: DUE });
    },
    reserveIfAvailable: () => {
      throw new Error('The checkout reserves all or fails');
    },
    isActiveWarehouse: () => {
      throw new Error('The checkout of a cart never chooses a warehouse');
    },
    commit: () => {
      throw new Error('The checkout never commits a reservation');
    },
    release: () => {
      throw new Error('The checkout never releases a reservation');
    },
    expire: () => {
      throw new Error('The checkout never expires a reservation');
    },
    restock: () => {
      throw new Error('The checkout never restocks');
    },
  };
  const shipping: CheckoutShipping = {
    quote: ({ subtotal, discount }): Promise<ShippingCharge> => {
      // The free shipping compares the subtotal less the discount (ADR-0079, ADR-0168).
      const given =
        options.coupon !== undefined && 'discount' in options.coupon
          ? options.coupon.discount
          : options.discount;
      expect(discount).toEqual(
        (given?.discounts ?? []).reduce((sum, each) => sum.add(each), mxn(0)),
      );
      const free = options.freeShipping === true;
      return Promise.resolve({
        cost: free ? mxn(0) : mxn(9_900),
        taxAmount: free ? mxn(0) : mxn(1_366),
        taxRateBp: 1600,
        freeShippingThreshold: subtotal.isZero() ? null : mxn(150_000),
        deliveryMinBusinessDays: 3,
        deliveryMaxBusinessDays: 7,
      });
    },
  };
  const customers: CheckoutCustomers = {
    contact: () => {
      calls.push('contact');
      return Promise.resolve(
        options.contact === undefined
          ? { email: 'ana@example.com', emailVerified: true }
          : options.contact,
      );
    },
    address: (customerId, addressId) => {
      calls.push('address');
      return Promise.resolve(
        customerId === buyer && addressId === savedId ? SAVED : null,
      );
    },
  };
  const locations: ShippingLocations = {
    resolve: () => {
      calls.push('resolve');
      return Promise.resolve(
        options.location ?? {
          stateName: 'Michoacán de Ocampo',
          municipalityName: 'Morelia',
        },
      );
    },
  };
  const orders = new InMemoryOrders(options.taken, options.couponUsers);
  const inline = {
    run: <T>(work: () => Promise<T>) => {
      calls.push('transaction');
      return work();
    },
  } as unknown as TransactionManager;
  const published: DomainEvent[] = [];
  const events = {
    publish: (...batch: DomainEvent[]) => {
      published.push(...batch);
    },
  } as unknown as DomainEventPublisher;
  const checkout = new Checkout(
    carts,
    catalog,
    prices,
    promotions,
    stock,
    shipping,
    customers,
    locations,
    orders,
    inline,
    events,
    { now: () => NOW },
    1600,
  );
  return {
    checkout,
    calls,
    reserved,
    checkedOut,
    orders,
    asked,
    published,
    promotionAsks,
    couponAsks,
    redeemed,
  };
}

const buyer = newId<'User'>() as CustomerId;
const savedId = newId();
const guestCartId = newId<'Cart'>();

function cartsWith(
  lines: [VariantId, number][],
  key: string = guestCartId,
): Map<string, CheckoutCart> {
  return new Map([
    [
      key,
      {
        id: key === guestCartId ? guestCartId : newId<'Cart'>(),
        lines: lines.map(([variantId, quantity]) => ({ variantId, quantity })),
      },
    ],
  ]);
}

const guestOrder = (
  changes: Partial<GuestOrderInput> = {},
): GuestOrderInput => ({
  guestCartId,
  contactEmail: 'cliente@example.com',
  shippingAddress: ADDRESS,
  privacyNoticeVersion: '2026-09',
  expectedTotal: 129_700,
  ...changes,
});

const customerOrder = (
  changes: Partial<CustomerOrderInput> = {},
): CustomerOrderInput => ({
  customerId: buyer,
  shippingAddress: { addressId: savedId },
  expectedTotal: 129_700,
  ...changes,
});

const BUEN_FIN = { id: newId<'Promotion'>(), name: 'Buen Fin 10%', code: null };
const COUPON = {
  id: newId<'Promotion'>(),
  name: 'Cupón de bienvenida',
  code: 'HOLA-10',
};

/** What Promotions answers for a coupon that applies, taking 5,990 off the shirts. */
const applies = (oncePerCustomer = false) => ({
  discount: { promotion: COUPON, oncePerCustomer, discounts: [mxn(5_990)] },
});

describe('Checkout: the promotion of the order (T-200 part b, ADR-0168)', () => {
  it('quotes the discount of each line, with the VAT left after it, and the promotion', async () => {
    const { checkout, promotionAsks } = setUp({
      carts: cartsWith([
        [shirt, 2],
        [draft, 1],
        [cap, 1],
      ]),
      discount: {
        promotion: BUEN_FIN,
        oncePerCustomer: false,
        discounts: [mxn(11_980), mxn(0)],
      },
    });

    const quote = await checkout.quote({ guestCartId });

    // Only the lines that can be sold, with their totals, in the order of the cart.
    expect(promotionAsks).toEqual([
      {
        channel: 'ONLINE',
        at: NOW,
        lines: [
          { variantId: shirt, lineTotal: mxn(119_800) },
          { variantId: cap, lineTotal: mxn(19_900) },
        ],
      },
    ]);
    expect(
      quote.lines.map(({ variantId, discountAmount, taxAmount }) => ({
        variantId,
        discountAmount,
        taxAmount,
      })),
    ).toEqual([
      // 107,820 × 1600 / 11600 = 14,871.72.
      { variantId: shirt, discountAmount: mxn(11_980), taxAmount: mxn(14_872) },
      { variantId: draft, discountAmount: null, taxAmount: null },
      { variantId: cap, discountAmount: mxn(0), taxAmount: mxn(2_745) },
    ]);
    expect(quote.totals).toEqual({
      subtotal: mxn(139_700),
      taxTotal: mxn(14_872 + 2_745 + 1_366),
      shippingCost: mxn(9_900),
      shippingTaxAmount: mxn(1_366),
      discountTotal: mxn(11_980),
      grandTotal: mxn(137_620),
    });
    expect(quote.promotion).toEqual(BUEN_FIN);
  });

  it('places the order with its discount and its promotion, the total including the discount', async () => {
    const { checkout, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
      discount: {
        promotion: BUEN_FIN,
        oncePerCustomer: false,
        discounts: [mxn(11_980)],
      },
    });

    await checkout.placeOrder(guestOrder({ expectedTotal: 117_720 }));

    expect(orders.saved[0].snapshot).toMatchObject({
      promotion: BUEN_FIN,
      lines: [{ discountAmount: mxn(11_980), taxAmount: mxn(14_872) }],
      totals: { discountTotal: mxn(11_980), grandTotal: mxn(117_720) },
    });
  });

  it('refuses the total without the discount', async () => {
    const { checkout, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
      discount: {
        promotion: BUEN_FIN,
        oncePerCustomer: false,
        discounts: [mxn(11_980)],
      },
    });

    await expect(
      checkout.placeOrder(guestOrder({ expectedTotal: 129_700 })),
    ).rejects.toMatchObject({
      code: 'total-mismatch',
      details: { currentTotal: { amount: 117_720, currency: 'MXN' } },
    });
    expect(orders.saved).toEqual([]);
  });
});

describe('Checkout: coupons (T-200 part c, ADR-0168)', () => {
  it('quotes with the coupon instead of the automatic promotions, asking for the code as given', async () => {
    const { checkout, calls, couponAsks, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
      discount: {
        promotion: BUEN_FIN,
        oncePerCustomer: false,
        discounts: [mxn(11_980)],
      },
      coupon: applies(),
    });

    const quote = await checkout.quote({ guestCartId }, 'hola-10');

    expect(calls).toEqual(['toQuote', 'coupon']);
    expect(couponAsks).toEqual([
      {
        channel: 'ONLINE',
        at: NOW,
        lines: [{ variantId: shirt, lineTotal: mxn(119_800) }],
        code: 'hola-10',
      },
    ]);
    expect(quote.promotion).toEqual(COUPON);
    expect(quote.totals.discountTotal).toEqual(mxn(5_990));
    // A quote never counts a use, nor asks the uses of a guest.
    expect(orders.couponAsks).toEqual([]);
  });

  it.each([
    ['unavailable'],
    ['exhausted'],
    ['minimumNotMet'],
    ['noEligibleLines'],
  ] as const)(
    'answers a coupon refused as %s, without falling back to the automatic promotion',
    async (reason) => {
      const { checkout } = setUp({
        carts: cartsWith([[shirt, 2]]),
        discount: {
          promotion: BUEN_FIN,
          oncePerCustomer: false,
          discounts: [mxn(11_980)],
        },
        coupon: { refused: reason },
      });

      await expect(checkout.quote({ guestCartId }, 'HOLA-10')).rejects.toThrow(
        new CouponNotApplicableError(reason),
      );
    },
  );

  it('tells a customer in the quote that they used a coupon of once per customer already', async () => {
    const { checkout, orders } = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      coupon: applies(true),
      contact: { email: 'Ana@Example.com', emailVerified: true },
      couponUsers: ['ana@example.com'],
    });

    await expect(
      checkout.quote({ customerId: buyer }, 'HOLA-10'),
    ).rejects.toMatchObject({
      code: 'coupon-not-applicable',
      reason: 'alreadyUsed',
    });
    // Counted by the contact email, normalized as the orders keep it.
    expect(orders.couponAsks).toEqual([[COUPON.id, 'ana@example.com']]);
  });

  it('quotes a coupon of once per customer for a customer who has not used it', async () => {
    const { checkout, orders } = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      coupon: applies(true),
      couponUsers: ['otra@example.com'],
    });

    const quote = await checkout.quote({ customerId: buyer }, 'HOLA-10');

    expect(quote.promotion).toEqual(COUPON);
    expect(orders.couponAsks).toEqual([[COUPON.id, 'ana@example.com']]);
  });

  it('never asks the uses of a customer for a coupon any customer can use again, nor of one without account', async () => {
    const reused = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      coupon: applies(),
    });
    const gone = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      coupon: applies(true),
      contact: null,
    });

    await reused.checkout.quote({ customerId: buyer }, 'HOLA-10');
    await gone.checkout.quote({ customerId: buyer }, 'HOLA-10');

    expect(reused.calls).not.toContain('contact');
    expect(reused.orders.couponAsks).toEqual([]);
    expect(gone.calls).toContain('contact');
    expect(gone.orders.couponAsks).toEqual([]);
  });

  it('places the order with the coupon, counting its use after the total and before the stock', async () => {
    const { checkout, calls, orders, redeemed } = setUp({
      carts: cartsWith([[shirt, 2]]),
      coupon: applies(),
    });

    await checkout.placeOrder(
      guestOrder({ expectedTotal: 123_710, couponCode: 'hola-10' }),
    );

    expect(calls).toEqual([
      'transaction',
      'lockToOrder',
      'resolve',
      'coupon',
      'redeem',
      'reserve',
      'checkOut',
    ]);
    expect(redeemed).toEqual([COUPON.id]);
    expect(orders.saved[0].snapshot).toMatchObject({
      promotion: COUPON,
      totals: { discountTotal: mxn(5_990), grandTotal: mxn(123_710) },
    });
    // Any customer can use it again: nobody asks their orders.
    expect(orders.couponAsks).toEqual([]);
  });

  it('counts no use of an automatic promotion', async () => {
    const { checkout, redeemed } = setUp({
      carts: cartsWith([[shirt, 2]]),
      discount: {
        promotion: BUEN_FIN,
        oncePerCustomer: false,
        discounts: [mxn(11_980)],
      },
    });

    await checkout.placeOrder(guestOrder({ expectedTotal: 117_720 }));

    expect(redeemed).toEqual([]);
  });

  it('counts no use when the total differs', async () => {
    const { checkout, redeemed } = setUp({
      carts: cartsWith([[shirt, 2]]),
      coupon: applies(),
    });

    await expect(
      checkout.placeOrder(guestOrder({ couponCode: 'HOLA-10' })),
    ).rejects.toBeInstanceOf(TotalMismatchError);
    expect(redeemed).toEqual([]);
  });

  it('answers exhausted when the last use went to another order, reserving nothing', async () => {
    const { checkout, reserved, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
      coupon: applies(),
      redeemable: false,
    });

    await expect(
      checkout.placeOrder(
        guestOrder({ expectedTotal: 123_710, couponCode: 'HOLA-10' }),
      ),
    ).rejects.toThrow(new CouponNotApplicableError('exhausted'));
    expect(reserved).toEqual([]);
    expect(orders.saved).toEqual([]);
  });

  it('answers alreadyUsed for a guest whose contact email used a coupon of once per customer, after counting it', async () => {
    const { checkout, calls, reserved, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
      coupon: applies(true),
      couponUsers: ['cliente@example.com'],
    });

    await expect(
      checkout.placeOrder(
        guestOrder({
          contactEmail: 'Cliente@Example.com',
          expectedTotal: 123_710,
          couponCode: 'HOLA-10',
        }),
      ),
    ).rejects.toThrow(new CouponNotApplicableError('alreadyUsed'));
    // Counting first locks the coupon, so a second order of the same buyer waits for the first and then finds it.
    expect(calls.slice(-1)).toEqual(['redeem']);
    expect(orders.couponAsks).toEqual([[COUPON.id, 'cliente@example.com']]);
    expect(reserved).toEqual([]);
  });

  it("places a customer's order with a coupon of once per customer they never used, by the account email", async () => {
    const { checkout, orders } = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      coupon: applies(true),
    });

    await checkout.placeOrder(
      customerOrder({ expectedTotal: 123_710, couponCode: 'HOLA-10' }),
    );

    expect(orders.couponAsks).toEqual([[COUPON.id, 'ana@example.com']]);
    expect(orders.saved[0].snapshot.promotion).toEqual(COUPON);
  });
});

describe('Checkout: quote (UC-ORD-01)', () => {
  it('prices the lines now, with VAT by line, shipping and delivery', async () => {
    const { checkout, calls } = setUp({ carts: cartsWith([[shirt, 2]]) });

    const quote = await checkout.quote({ guestCartId });

    expect(quote).toEqual({
      lines: [
        {
          variantId: shirt,
          quantity: 2,
          sku: `SKU-${shirt.slice(-4)}`,
          productTitle: 'Camisa de lino',
          options: { talla: 'M' },
          unitPrice: mxn(59_900),
          lineTotal: mxn(119_800),
          discountAmount: mxn(0),
          taxRateBp: 1600,
          taxAmount: mxn(16_524),
          sellable: true,
          canFulfill: true,
        },
      ],
      totals: {
        subtotal: mxn(119_800),
        taxTotal: mxn(17_890),
        shippingCost: mxn(9_900),
        shippingTaxAmount: mxn(1_366),
        discountTotal: mxn(0),
        grandTotal: mxn(129_700),
      },
      promotion: null,
      freeShippingThreshold: mxn(150_000),
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
      readyToPlace: true,
    });
    // A quote never locks, reserves nor writes anything.
    expect(calls).toEqual(['toQuote', 'promotions']);
  });

  it('marks the lines that cannot be sold, asks the stock only for the others, and totals only them', async () => {
    const { checkout, asked } = setUp({
      carts: cartsWith([
        [shirt, 2],
        [draft, 1],
        [unpriced, 1],
        [service, 1],
        [cap, 3],
      ]),
      available: new Set([shirt]),
    });

    const quote = await checkout.quote({ guestCartId });

    expect(
      quote.lines.map(({ variantId, sellable, canFulfill, unitPrice }) => [
        variantId,
        sellable,
        canFulfill,
        unitPrice,
      ]),
    ).toEqual([
      [shirt, true, true, mxn(59_900)],
      [draft, false, false, null],
      [unpriced, false, false, null],
      [service, false, false, null],
      [cap, true, false, mxn(19_900)],
    ]);
    expect(quote.lines[1]).toMatchObject({
      lineTotal: null,
      taxRateBp: null,
      taxAmount: null,
    });
    expect(asked.stock).toEqual([
      [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 3 },
      ],
    ]);
    expect(quote.totals.subtotal).toEqual(mxn(119_800 + 59_700));
    expect(quote.readyToPlace).toBe(false);
  });

  it('is not ready to place when a sellable line cannot be fulfilled', async () => {
    const { checkout } = setUp({
      carts: cartsWith([[shirt, 2]]),
      available: new Set(),
    });

    expect((await checkout.quote({ guestCartId })).readyToPlace).toBe(false);
  });

  it('passes on the free shipping and the threshold of Shipping', async () => {
    const { checkout } = setUp({
      carts: cartsWith([[shirt, 3]]),
      freeShipping: true,
    });

    const quote = await checkout.quote({ guestCartId });

    expect(quote.totals).toMatchObject({
      shippingCost: mxn(0),
      grandTotal: mxn(179_700),
    });
  });

  it('answers empty-cart for a cart without lines or a customer without a cart (BR-ORD-01)', async () => {
    const { checkout } = setUp({ carts: cartsWith([]) });

    await expect(checkout.quote({ guestCartId })).rejects.toThrow(
      EmptyCartError,
    );
    await expect(checkout.quote({ customerId: buyer })).rejects.toThrow(
      EmptyCartError,
    );
  });

  it('answers a line of a variant Catalog does not know as not found', async () => {
    const unknown = newId<'Variant'>();
    const { checkout } = setUp({ carts: cartsWith([[unknown, 1]]) });

    await expect(checkout.quote({ guestCartId })).rejects.toThrow(
      new NotFoundError('Variant', unknown),
    );
  });
});

describe('Checkout: placing an order (UC-ORD-02)', () => {
  it("places a guest's order in one transaction: locks the cart, reserves, saves and checks the cart out", async () => {
    const { checkout, calls, reserved, checkedOut, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
    });

    const id = await checkout.placeOrder(guestOrder());

    expect(calls).toEqual([
      'transaction',
      'lockToOrder',
      'resolve',
      'promotions',
      'reserve',
      'checkOut',
    ]);
    expect(reserved).toEqual([
      { orderId: id, lines: [{ variantId: shirt, quantity: 2 }] },
    ]);
    expect(checkedOut).toEqual([guestCartId]);
    const order = orders.saved[0].snapshot;
    expect(order).toMatchObject({
      id,
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE,
      sourceCartId: guestCartId,
      placedAt: NOW,
      shippingTaxRateBp: 1600,
      deliveryMinBusinessDays: 3,
      deliveryMaxBusinessDays: 7,
      shippingAddress: {
        ...ADDRESS,
        stateName: 'Michoacán de Ocampo',
        municipalityName: 'Morelia',
        country: 'MX',
      },
    });
    expect(order.totals.grandTotal).toEqual(mxn(129_700));
    expect(order.lines).toEqual([
      expect.objectContaining({
        lineNumber: 1,
        variantId: shirt,
        sku: `SKU-${shirt.slice(-4)}`,
        productName: 'Camisa de lino',
        variantOptions: { talla: 'M' },
        taxAmount: mxn(16_524),
      }),
    ]);
  });

  it("places a customer's order with a saved address and the account email", async () => {
    const { checkout, calls, orders } = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
    });

    await checkout.placeOrder(customerOrder());

    expect(calls.slice(0, 4)).toEqual([
      'transaction',
      'contact',
      'lockToOrder',
      'address',
    ]);
    expect(orders.saved[0].snapshot).toMatchObject({
      customerId: buyer,
      contactEmail: 'ana@example.com',
      privacyNoticeVersion: null,
      shippingAddress: SAVED,
    });
  });

  it("places a customer's order with an address written for it", async () => {
    const { checkout, calls, orders } = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
    });

    await checkout.placeOrder(customerOrder({ shippingAddress: ADDRESS }));

    expect(calls).toContain('resolve');
    expect(calls).not.toContain('address');
    expect(orders.saved[0].snapshot.shippingAddress).toMatchObject({
      street: 'Av. Madero',
      municipalityName: 'Morelia',
    });
  });

  it('draws another public code while the one drawn is taken (ADR-0049)', async () => {
    const { checkout, orders } = setUp({
      carts: cartsWith([[shirt, 2]]),
      taken: 2,
    });

    const id = await checkout.placeOrder(guestOrder());

    expect(orders.tried).toHaveLength(3);
    expect(new Set(orders.tried.map(({ id }) => id))).toEqual(new Set([id]));
    expect(orders.saved).toEqual([orders.tried[2]]);
  });

  it('gives up after 5 taken public codes', async () => {
    const { checkout, orders, checkedOut } = setUp({
      carts: cartsWith([[shirt, 2]]),
      taken: 5,
    });

    await expect(checkout.placeOrder(guestOrder())).rejects.toThrow(
      'No free public code after 5 attempts',
    );
    expect(orders.tried).toHaveLength(5);
    expect(checkedOut).toEqual([]);
  });

  it('checks the buyer first: an unverified email or a customer gone stops it before the cart (BR-USR-05)', async () => {
    const unverified = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      contact: { email: 'ana@example.com', emailVerified: false },
    });
    const gone = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
      contact: null,
    });

    await expect(
      unverified.checkout.placeOrder(customerOrder()),
    ).rejects.toThrow(EmailNotVerifiedError);
    await expect(gone.checkout.placeOrder(customerOrder())).rejects.toThrow(
      NotFoundError,
    );
    expect(unverified.calls).toEqual(['transaction', 'contact']);
  });

  it('answers empty-cart for a cart without lines or a customer without a cart, before the address', async () => {
    const empty = setUp({ carts: cartsWith([]) });
    const none = setUp();

    await expect(empty.checkout.placeOrder(guestOrder())).rejects.toThrow(
      EmptyCartError,
    );
    await expect(none.checkout.placeOrder(customerOrder())).rejects.toThrow(
      EmptyCartError,
    );
    expect(empty.calls).not.toContain('resolve');
    expect(none.calls).not.toContain('address');
  });

  it("answers 404 for another customer's saved address", async () => {
    const { checkout, calls } = setUp({
      carts: cartsWith([[shirt, 2]], buyer),
    });

    await expect(
      checkout.placeOrder(
        customerOrder({ shippingAddress: { addressId: newId() } }),
      ),
    ).rejects.toThrow(NotFoundError);
    expect(calls).not.toContain('reserve');
  });

  it('rejects a state or municipality that is not valid as a validation error of shippingAddress', async () => {
    const { checkout, calls } = setUp({
      carts: cartsWith([[shirt, 2]]),
      location: 'inactive-municipality',
    });

    await expect(checkout.placeOrder(guestOrder())).rejects.toThrow(
      new InvalidShippingAddressError('inactive-municipality'),
    );
    expect(calls).not.toContain('reserve');
  });

  it('rejects every line that cannot be sold, before checking the total', async () => {
    const { checkout, calls } = setUp({
      carts: cartsWith([
        [shirt, 2],
        [draft, 1],
        [unpriced, 1],
        [service, 1],
      ]),
    });

    const failure = checkout.placeOrder(guestOrder({ expectedTotal: 1 }));

    await expect(failure).rejects.toThrow(VariantNotSellableError);
    await expect(failure).rejects.toMatchObject({
      details: { variantIds: [draft, unpriced, service] },
    });
    expect(calls).not.toContain('reserve');
  });

  it('answers total-mismatch with the current total, reserving nothing (BR-ORD-06)', async () => {
    const { checkout, calls } = setUp({ carts: cartsWith([[shirt, 2]]) });

    const failure = checkout.placeOrder(guestOrder({ expectedTotal: 129_699 }));

    await expect(failure).rejects.toThrow(TotalMismatchError);
    await expect(failure).rejects.toMatchObject({
      details: { currentTotal: { amount: 129_700, currency: 'MXN' } },
    });
    expect(calls).not.toContain('reserve');
  });

  it('saves nothing and keeps the cart when the stock is short', async () => {
    const { checkout, orders, checkedOut } = setUp({
      carts: cartsWith([[shirt, 2]]),
      shortOf: [shirt],
    });

    await expect(checkout.placeOrder(guestOrder())).rejects.toThrow(
      `short of ${shirt}`,
    );
    expect(orders.tried).toEqual([]);
    expect(checkedOut).toEqual([]);
  });

  it('reads the prices of every line at the time of the order', async () => {
    const { checkout, asked } = setUp({
      carts: cartsWith([
        [shirt, 2],
        [cap, 1],
      ]),
    });

    await checkout.placeOrder(guestOrder({ expectedTotal: 149_600 }));

    expect(asked.prices).toEqual([[shirt, cap]]);
  });
});

describe('Checkout: the event of a placed order (ADR-0074, ADR-0143)', () => {
  it('publishes OrderPlaced with the order, for its email', async () => {
    const { checkout, published } = setUp({ carts: cartsWith([[shirt, 2]]) });

    const id = await checkout.placeOrder(guestOrder());

    expect(published).toEqual([
      {
        eventId: expect.any(String),
        eventType: 'OrderPlaced',
        occurredAt: NOW,
        orderId: id,
      },
    ]);
  });

  it('publishes nothing when the order is not placed', async () => {
    const { checkout, published } = setUp({
      carts: cartsWith([[shirt, 2]]),
      shortOf: [shirt],
    });

    await expect(checkout.placeOrder(guestOrder())).rejects.toThrow();

    expect(published).toEqual([]);
  });
});
