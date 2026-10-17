import {
  type AuditEntry,
  type AuditTrail,
  type DomainEvent,
  type DomainEventPublisher,
  InvalidValueError,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import type {
  CustomerId,
  Order,
  OrderId,
  ShippingAddress,
  StaffId,
  VariantId,
  WarehouseId,
} from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import {
  CouponNotApplicableError,
  EmailNotVerifiedError,
  TotalMismatchError,
  VariantNotSellableError,
} from '../domain/ordering-errors.js';
import type {
  CheckoutCatalog,
  CheckoutCustomers,
  CheckoutPrices,
  CheckoutPromotions,
  OrderDiscount,
  CheckoutShipping,
  CheckoutVariant,
  OrderStock,
  ShippingLocations,
  StockLine,
} from './checkout-ports.js';
import type { AddressInput } from './order-placement.js';
import {
  StaffCheckout,
  type StaffOrderInput,
} from './staff-checkout.use-case.js';

// Test doubles of the unit tests of the checkout of the staff in the physical store (ADR-0161).

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DUE = new Date('2026-10-06T12:20:00.000Z');
const mxn = (amount: number) => Money.of(amount, 'MXN');

const ADDRESS: AddressInput = {
  recipientName: 'María López',
  phone: '4431234567',
  street: 'Av. Madero',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: null,
  references: null,
};

const SAVED: ShippingAddress = {
  ...ADDRESS,
  street: 'Calle Guardada',
  stateName: 'Michoacán de Ocampo',
  municipalityName: 'Morelia',
  country: 'MX',
};

const [shirt, cap, draft] = [
  newId<'Variant'>(),
  newId<'Variant'>(),
  newId<'Variant'>(),
];
const store = newId<'Warehouse'>() as WarehouseId;
const staffId = newId<'User'>() as StaffId;
const customer = newId<'User'>() as CustomerId;
const savedId = newId();

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

/** Orders in memory; the contact emails in `couponUsers` used the coupon already. */
class InMemoryOrders extends OrderRepository {
  readonly saved: Order[] = [];
  readonly couponAsks: [string, string][] = [];

  constructor(private readonly couponUsers: readonly string[] = []) {
    super();
  }

  usedCoupon(promotionId: string, contactEmail: string): Promise<boolean> {
    this.couponAsks.push([promotionId, contactEmail]);
    return Promise.resolve(this.couponUsers.includes(contactEmail));
  }

  insert(order: Order): Promise<boolean> {
    this.saved.push(order);
    return Promise.resolve(true);
  }

  lock(): never {
    throw new Error('The checkout never locks a saved order');
  }

  lockByPublicCode(): never {
    throw new Error('The checkout never locks a saved order');
  }

  dueForBlocking(): never {
    throw new Error('The checkout never blocks orders');
  }

  dueForAnonymization(): never {
    throw new Error('The checkout never anonymizes orders');
  }

  dueForExpiry(): never {
    throw new Error('The checkout never expires orders');
  }

  lockOf(): never {
    throw new Error('The checkout never anonymizes orders');
  }

  save(): never {
    throw new Error('The checkout never saves a placed order again');
  }
}

/** Every port in memory; `calls` records, in order, what the checkout asked. */
function setUp(
  options: {
    activeWarehouse?: boolean;
    available?: ReadonlySet<VariantId>;
    contact?: { email: string; emailVerified: boolean } | null;
    /** What Promotions answers for the lines that can be sold. */
    discount?: OrderDiscount | null;
    /** What Promotions answers for a coupon; by default, that none has the code. */
    coupon?: Awaited<ReturnType<CheckoutPromotions['couponFor']>>;
    /** The contact emails that used the coupon already. */
    couponUsers?: string[];
  } = {},
) {
  const calls: string[] = [];
  const reserved: {
    orderId: OrderId;
    lines: StockLine[];
    warehouseId: WarehouseId | null | undefined;
  }[] = [];
  const fulfillableIn: (WarehouseId | null | undefined)[] = [];
  const catalog: CheckoutCatalog = {
    variants: (ids) => {
      calls.push('variants');
      return Promise.resolve(
        new Map(
          // The cap is sold only in the store, which a sale in the store sells (ADR-0165).
          [variant(shirt), variant(cap, true, true), variant(draft, false)]
            .filter(({ id }) => ids.includes(id))
            .map((v) => [v.id, v]),
        ),
      );
    },
  };
  const prices: CheckoutPrices = {
    current: (ids) =>
      Promise.resolve(
        new Map(
          (
            [
              [shirt, 59_900],
              [cap, 19_900],
              [draft, 100],
            ] as const
          )
            .filter(([id]) => ids.includes(id))
            .map(([id, amount]) => [id, mxn(amount)]),
        ),
      ),
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
      return Promise.resolve(true);
    },
  };
  const stock: OrderStock = {
    canFulfill: (lines, warehouseId) => {
      fulfillableIn.push(warehouseId);
      return Promise.resolve(
        new Map(
          lines.map(({ variantId }) => [
            variantId,
            (options.available ?? new Set([shirt, cap])).has(variantId),
          ]),
        ),
      );
    },
    reserve: (orderId, lines, warehouseId) => {
      calls.push('reserve');
      reserved.push({
        orderId,
        lines: lines.map((line) => ({ ...line })),
        warehouseId,
      });
      return Promise.resolve({ id: newId<'Reservation'>(), expiresAt: DUE });
    },
    reserveIfAvailable: () => {
      throw new Error('The checkout reserves all or fails');
    },
    isActiveWarehouse: (warehouseId) => {
      calls.push(`isActiveWarehouse ${warehouseId === store ? 'store' : '?'}`);
      return Promise.resolve(options.activeWarehouse ?? true);
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
    quote: () => {
      calls.push('shipping');
      return Promise.resolve({
        cost: mxn(9_900),
        taxAmount: mxn(1_366),
        taxRateBp: 1600,
        freeShippingThreshold: mxn(150_000),
        deliveryMinBusinessDays: 3,
        deliveryMaxBusinessDays: 7,
      });
    },
  };
  const customers: CheckoutCustomers = {
    contact: (customerId) => {
      calls.push('contact');
      expect(customerId).toBe(customer);
      return Promise.resolve(
        options.contact === undefined
          ? { email: 'ana@example.com', emailVerified: true }
          : options.contact,
      );
    },
    address: (customerId, addressId) => {
      calls.push('address');
      return Promise.resolve(
        customerId === customer && addressId === savedId ? SAVED : null,
      );
    },
  };
  const locations: ShippingLocations = {
    resolve: () => {
      calls.push('resolve');
      return Promise.resolve({
        stateName: 'Michoacán de Ocampo',
        municipalityName: 'Morelia',
      });
    },
  };
  const orders = new InMemoryOrders(options.couponUsers);
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
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      calls.push('audit');
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  const checkout = new StaffCheckout(
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
    audit,
    { now: () => NOW },
    1600,
  );
  return {
    checkout,
    calls,
    reserved,
    fulfillableIn,
    orders,
    published,
    audited,
    promotionAsks,
    couponAsks,
    redeemed,
  };
}

/** Two shirts: $1,198.00 plus $99.00 of shipping. */
const order = (changes: Partial<StaffOrderInput> = {}): StaffOrderInput => ({
  staffId,
  warehouseId: store,
  fulfillment: 'SHIPPING',
  lines: [{ variantId: shirt, quantity: 2 }],
  buyer: { customerId: customer },
  shippingAddress: { addressId: savedId },
  expectedTotal: 129_700,
  ...changes,
});

const guest = {
  contactEmail: ' Cliente@Example.com ',
  privacyNoticeVersion: '2026-09',
};

describe('StaffCheckout: quote (UC-ORD-12, ADR-0161)', () => {
  it('quotes the lines with the stock of the warehouse the staff chose', async () => {
    const { checkout, fulfillableIn, calls } = setUp({
      available: new Set([shirt]),
    });

    const quote = await checkout.quote({
      lines: [
        { variantId: shirt, quantity: 2 },
        { variantId: cap, quantity: 1 },
        { variantId: draft, quantity: 1 },
      ],
      warehouseId: store,
      fulfillment: 'SHIPPING',
    });

    expect(calls.slice(0, 2)).toEqual(['isActiveWarehouse store', 'variants']);
    expect(fulfillableIn).toEqual([store]);
    expect(
      quote.lines.map(({ variantId, sellable, canFulfill }) => [
        variantId,
        sellable,
        canFulfill,
      ]),
    ).toEqual([
      [shirt, true, true],
      [cap, true, false],
      [draft, false, false],
    ]);
    expect(quote.totals.subtotal).toEqual(mxn(139_700));
    expect(quote.readyToPlace).toBe(false);
  });

  it('answers a warehouse that does not exist or is not active as not found, before reading the lines', async () => {
    const { checkout, calls } = setUp({ activeWarehouse: false });

    await expect(
      checkout.quote({
        lines: [{ variantId: shirt, quantity: 1 }],
        warehouseId: store,
        fulfillment: 'SHIPPING',
      }),
    ).rejects.toThrow(new NotFoundError('Warehouse', store));
    expect(calls).toEqual(['isActiveWarehouse store']);
  });

  it('answers a variant that does not exist as not found', async () => {
    const unknown = newId<'Variant'>();

    await expect(
      setUp().checkout.quote({
        lines: [{ variantId: unknown, quantity: 1 }],
        warehouseId: store,
        fulfillment: 'SHIPPING',
      }),
    ).rejects.toThrow(new NotFoundError('Variant', unknown));
  });

  it('rejects lines out of their limits, or a variant twice, before reading anything', async () => {
    const { checkout, calls } = setUp();
    const many = Array.from({ length: 101 }, () => ({
      variantId: newId<'Variant'>(),
      quantity: 1,
    }));

    for (const lines of [
      [],
      many,
      [{ variantId: shirt, quantity: 0 }],
      [{ variantId: shirt, quantity: 31 }],
      [{ variantId: shirt, quantity: 1.5 }],
      [
        { variantId: shirt, quantity: 1 },
        { variantId: shirt, quantity: 2 },
      ],
    ]) {
      await expect(
        checkout.quote({ lines, warehouseId: store, fulfillment: 'SHIPPING' }),
      ).rejects.toThrow(InvalidValueError);
    }
    expect(calls).toEqual([]);
    // The limits themselves pass: 30 units, and 100 lines, here of variants that do not exist.
    await checkout.quote({
      lines: [{ variantId: shirt, quantity: 30 }],
      warehouseId: store,
      fulfillment: 'SHIPPING',
    });
    await expect(
      checkout.quote({
        lines: many.slice(0, 100),
        warehouseId: store,
        fulfillment: 'SHIPPING',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('StaffCheckout: place (UC-ORD-13, ADR-0161)', () => {
  it('places a store order for a customer, with the stock of the warehouse, and audits who placed it', async () => {
    const { checkout, calls, reserved, orders, published, audited } = setUp();

    const id = await checkout.place(order());

    expect(calls).toEqual([
      'transaction',
      'contact',
      'isActiveWarehouse store',
      'address',
      'variants',
      'promotions',
      'shipping',
      'reserve',
      'audit',
    ]);
    expect(reserved).toEqual([
      {
        orderId: id,
        lines: [{ variantId: shirt, quantity: 2 }],
        warehouseId: store,
      },
    ]);
    const [placed] = orders.saved;
    expect(placed.snapshot).toMatchObject({
      id,
      status: 'PENDING_PAYMENT',
      channel: 'STORE',
      sourceCartId: null,
      placedBy: staffId,
      warehouseId: store,
      customerId: customer,
      contactEmail: 'ana@example.com',
      privacyNoticeVersion: null,
      shippingAddress: SAVED,
      paymentDueAt: DUE,
      placedAt: NOW,
    });
    expect(audited).toEqual([
      {
        action: 'orders.place',
        resource: { type: 'order', id },
        changes: {
          status: { from: null, to: 'PENDING_PAYMENT' },
          channel: { from: null, to: 'STORE' },
          fulfillment: { from: null, to: 'SHIPPING' },
          warehouseId: { from: null, to: store },
        },
      },
    ]);
    expect(published).toEqual([
      expect.objectContaining({ eventType: 'OrderPlaced', orderId: id }),
    ]);
  });

  it('places a store order for a guest, with the contact and the privacy notice the staff presented', async () => {
    const { checkout, calls, orders } = setUp();

    await checkout.place(order({ buyer: guest, shippingAddress: ADDRESS }));

    expect(calls).not.toContain('contact');
    expect(calls).toContain('resolve');
    expect(orders.saved[0].snapshot).toMatchObject({
      customerId: null,
      contactEmail: 'cliente@example.com',
      privacyNoticeVersion: '2026-09',
      channel: 'STORE',
    });
  });

  it('answers a saved address named for a guest as not found, without asking for it', async () => {
    const { checkout, calls } = setUp();

    await expect(checkout.place(order({ buyer: guest }))).rejects.toThrow(
      new NotFoundError('Address', savedId),
    );
    expect(calls).not.toContain('address');
  });

  it('answers a warehouse that is not active as not found, reserving nothing', async () => {
    const { checkout, reserved } = setUp({ activeWarehouse: false });

    await expect(checkout.place(order())).rejects.toThrow(
      new NotFoundError('Warehouse', store),
    );
    expect(reserved).toEqual([]);
  });

  it('checks the buyer as the online checkout does', async () => {
    await expect(
      setUp({
        contact: { email: 'ana@example.com', emailVerified: false },
      }).checkout.place(order()),
    ).rejects.toThrow(EmailNotVerifiedError);
    await expect(
      setUp({ contact: null }).checkout.place(order()),
    ).rejects.toThrow(new NotFoundError('Customer', customer));
  });

  it('places nothing for a line that cannot be sold or a total that changed', async () => {
    const unsellable = setUp();
    await expect(
      unsellable.checkout.place(
        order({
          lines: [
            { variantId: shirt, quantity: 2 },
            { variantId: draft, quantity: 1 },
          ],
        }),
      ),
    ).rejects.toThrow(new VariantNotSellableError([draft]));
    expect(unsellable.reserved).toEqual([]);

    const changed = setUp();
    await expect(
      changed.checkout.place(order({ expectedTotal: 129_699 })),
    ).rejects.toThrow(TotalMismatchError);
    expect(changed.reserved).toEqual([]);
    expect(changed.orders.saved).toEqual([]);
  });

  it('rejects lines out of their limits before opening the transaction', async () => {
    const { checkout, calls } = setUp();

    await expect(checkout.place(order({ lines: [] }))).rejects.toThrow(
      InvalidValueError,
    );
    expect(calls).toEqual([]);
  });
});

describe('StaffCheckout: a sale handed over in the store (ADR-0161)', () => {
  const counter = (changes: Partial<StaffOrderInput> = {}) =>
    order({
      fulfillment: 'IN_STORE',
      buyer: null,
      shippingAddress: null,
      expectedTotal: 119_800,
      ...changes,
    });

  it('quotes it without shipping nor a delivery time', async () => {
    const { checkout, calls } = setUp();

    const quote = await checkout.quote({
      lines: [{ variantId: shirt, quantity: 2 }],
      warehouseId: store,
      fulfillment: 'IN_STORE',
    });

    expect(calls).not.toContain('shipping');
    expect(quote).toMatchObject({
      freeShippingThreshold: null,
      deliveryMinBusinessDays: null,
      deliveryMaxBusinessDays: null,
    });
    expect(quote.totals).toMatchObject({
      shippingCost: mxn(0),
      grandTotal: mxn(119_800),
    });
  });

  it('gets the promotions of the physical store, and a sale at 100% charges one peso (ADR-0168)', async () => {
    const promotion = {
      id: newId<'Promotion'>(),
      name: 'Todo gratis',
      code: null,
    };
    const { checkout, orders, promotionAsks } = setUp({
      discount: {
        promotion,
        oncePerCustomer: false,
        discounts: [mxn(119_700)],
      },
    });

    const quote = await checkout.quote({
      lines: [{ variantId: shirt, quantity: 2 }],
      warehouseId: store,
      fulfillment: 'IN_STORE',
    });
    await checkout.place(counter({ expectedTotal: 100 }));

    expect(promotionAsks).toEqual([
      {
        channel: 'STORE',
        at: NOW,
        lines: [{ variantId: shirt, lineTotal: mxn(119_800) }],
      },
      {
        channel: 'STORE',
        at: NOW,
        lines: [{ variantId: shirt, lineTotal: mxn(119_800) }],
      },
    ]);
    expect(quote).toMatchObject({
      promotion,
      totals: { discountTotal: mxn(119_700), grandTotal: mxn(100) },
    });
    expect(orders.saved[0].snapshot).toMatchObject({
      promotion,
      totals: { discountTotal: mxn(119_700), grandTotal: mxn(100) },
    });
  });

  it('places it without an address nor buyer data, and audits how it is delivered', async () => {
    const { checkout, calls, orders, audited } = setUp();

    const id = await checkout.place(counter());

    expect(calls).toEqual([
      'transaction',
      'isActiveWarehouse store',
      'variants',
      'promotions',
      'reserve',
      'audit',
    ]);
    expect(orders.saved[0].snapshot).toMatchObject({
      id,
      fulfillment: 'IN_STORE',
      customerId: null,
      contactEmail: null,
      shippingAddress: null,
    });
    expect(audited[0].changes).toMatchObject({
      fulfillment: { from: null, to: 'IN_STORE' },
    });
  });

  it('places a product sold only in the store, which an online order does not (ADR-0165)', async () => {
    const { checkout, orders } = setUp();

    await checkout.place(
      counter({
        lines: [{ variantId: cap, quantity: 1 }],
        expectedTotal: 19_900,
      }),
    );

    expect(orders.saved[0].snapshot.lines).toEqual([
      expect.objectContaining({ variantId: cap, quantity: 1 }),
    ]);
  });

  it('places it for a customer or a guest who gives their data too', async () => {
    const { checkout, orders } = setUp();

    await checkout.place(counter({ buyer: { customerId: customer } }));
    await checkout.place(counter({ buyer: guest }));

    expect(
      orders.saved.map(({ snapshot }) => [
        snapshot.customerId,
        snapshot.contactEmail,
      ]),
    ).toEqual([
      [customer, 'ana@example.com'],
      [null, 'cliente@example.com'],
    ]);
  });

  it('rejects an order to ship without a buyer or an address, and one handed over with an address', async () => {
    const { checkout, calls } = setUp();

    for (const input of [
      order({ buyer: null }),
      order({ shippingAddress: null }),
      counter({ shippingAddress: ADDRESS }),
    ]) {
      await expect(checkout.place(input)).rejects.toThrow(InvalidValueError);
    }
    expect(calls).toEqual([]);
  });

  it('answers the total of the lines alone', async () => {
    await expect(
      setUp().checkout.place(counter({ expectedTotal: 129_700 })),
    ).rejects.toThrow(TotalMismatchError);
  });
});

describe('StaffCheckout: coupons (T-200 part c, ADR-0168)', () => {
  const COUPON = {
    id: newId<'Promotion'>(),
    name: 'Cupón de la tienda',
    code: 'TIENDA-10',
  };
  const applies = (oncePerCustomer = false) => ({
    discount: { promotion: COUPON, oncePerCustomer, discounts: [mxn(11_980)] },
  });
  const counter = (changes: Partial<StaffOrderInput> = {}) =>
    order({
      fulfillment: 'IN_STORE',
      buyer: null,
      shippingAddress: null,
      expectedTotal: 107_820,
      couponCode: 'tienda-10',
      ...changes,
    });

  it('quotes with the coupon of the physical store', async () => {
    const { checkout, calls, couponAsks, orders } = setUp({
      coupon: applies(true),
    });

    const quote = await checkout.quote({
      lines: [{ variantId: shirt, quantity: 2 }],
      warehouseId: store,
      fulfillment: 'IN_STORE',
      couponCode: 'tienda-10',
    });

    expect(calls).not.toContain('promotions');
    expect(couponAsks).toEqual([
      {
        channel: 'STORE',
        at: NOW,
        lines: [{ variantId: shirt, lineTotal: mxn(119_800) }],
        code: 'tienda-10',
      },
    ]);
    expect(quote).toMatchObject({
      promotion: COUPON,
      totals: { discountTotal: mxn(11_980), grandTotal: mxn(107_820) },
    });
    // The quote of the staff has no buyer: placing the order checks the uses.
    expect(orders.couponAsks).toEqual([]);
  });

  it('answers a coupon that does not apply', async () => {
    const { checkout } = setUp({ coupon: { refused: 'minimumNotMet' } });

    await expect(checkout.place(counter())).rejects.toThrow(
      new CouponNotApplicableError('minimumNotMet'),
    );
  });

  it('places a sale handed over without buyer data with a coupon any customer can use again, counting its use', async () => {
    const { checkout, calls, orders, redeemed } = setUp({ coupon: applies() });

    await checkout.place(counter());

    expect(calls).toEqual([
      'transaction',
      'isActiveWarehouse store',
      'variants',
      'coupon',
      'redeem',
      'reserve',
      'audit',
    ]);
    expect(redeemed).toEqual([COUPON.id]);
    expect(orders.saved[0].snapshot.promotion).toEqual(COUPON);
  });

  it('answers buyerRequired for a coupon of once per customer without buyer data, counting nothing', async () => {
    const { checkout, redeemed, orders } = setUp({ coupon: applies(true) });

    await expect(checkout.place(counter())).rejects.toThrow(
      new CouponNotApplicableError('buyerRequired'),
    );
    expect(redeemed).toEqual([]);
    expect(orders.saved).toEqual([]);
  });

  it('checks a coupon of once per customer by the contact email of the guest, normalized', async () => {
    const { checkout, orders } = setUp({
      coupon: applies(true),
      couponUsers: ['cliente@example.com'],
    });

    await expect(checkout.place(counter({ buyer: guest }))).rejects.toThrow(
      new CouponNotApplicableError('alreadyUsed'),
    );
    expect(orders.couponAsks).toEqual([[COUPON.id, 'cliente@example.com']]);
  });
});
