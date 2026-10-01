import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { Clock, newId } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CartRestoration } from '../application/cart-restoration.use-case.js';
import { Carts } from '../application/carts.use-case.js';
import type { CartId, CustomerId, VariantId } from '../domain/cart.js';
import { ShoppingModule } from '../shopping.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-01T12:00:00.000Z');
const CHECKED_OUT_AT = new Date(START);
const EXPIRED = new Date(START + 21 * 60_000);
/** Class of the advisory locks of customers' carts (ADR-0131). */
const CUSTOMER_CART_LOCK = 0x43415254;

/** The lines of expired orders back in their carts, against PostgreSQL 18 (T-181 part a, ADR-0137). */
describe('Shopping: carts of expired orders (T-181)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let current = START;
  const clock = {
    now: () => {
      current += 1_000;
      return new Date(current);
    },
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        EventsModule,
        AppCacheModule,
        AuditModule,
        ShoppingModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    current = EXPIRED.getTime();
  });

  afterEach(async () => {
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany({
      where: { mergedIntoCartId: { not: null } },
    });
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);
  const restore = (
    customerId: CustomerId | null,
    sourceCartId: CartId,
    lines: { variantId: VariantId; quantity: number }[],
  ) =>
    run(() =>
      moduleRef.get(CartRestoration).restoreExpiredOrder({
        customerId,
        sourceCartId,
        lines,
        expiredAt: EXPIRED,
      }),
    );

  /** A cart with its lines, last changed when it was checked out unless it is active. */
  async function cart(
    status: 'ACTIVE' | 'CHECKED_OUT',
    owner: CustomerId | null,
    lines: { variantId: VariantId; quantity: number }[],
  ): Promise<CartId> {
    const id = newId<'Cart'>();
    await prisma.cart.create({
      data: {
        id,
        ownerUserId: owner,
        status,
        lastActivityAt: CHECKED_OUT_AT,
        createdAt: CHECKED_OUT_AT,
        updatedAt: CHECKED_OUT_AT,
        lines: {
          create: lines.map((line, index) => ({
            ...line,
            createdAt: new Date(START - 1_000 + index),
            updatedAt: CHECKED_OUT_AT,
          })),
        },
      },
    });
    return id;
  }

  /** A sellable variant: published, active, priced and with stock. */
  async function sellable(): Promise<VariantId> {
    const productId = newId();
    const id = newId<'Variant'>();
    await prisma.product.create({
      data: {
        id: productId,
        title: 'Camisa de lino',
        slug: `camisa-${productId.slice(-12)}`,
        status: 'PUBLISHED',
        variants: {
          create: {
            id,
            sku: `SKU-${id.slice(-12)}`.toUpperCase(),
            options: { talla: 'M' },
            status: 'ACTIVE',
          },
        },
      },
    });
    await prisma.variantPrice.create({
      data: {
        id: newId(),
        priceListId: DEFAULT_LIST,
        variantId: id,
        periods: {
          create: {
            id: newId(),
            amount: 10_000,
            effectiveFrom: new Date(START - 86_400_000),
            createdBy: newId(),
          },
        },
      },
    });
    await prisma.stockItem.create({
      data: { id: newId(), variantId: id, warehouseId: MAIN, onHand: 5 },
    });
    return id;
  }

  const row = (id: CartId) =>
    prisma.cart.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
  const linesOf = async (id: CartId) =>
    (await row(id)).lines.map(({ variantId, quantity }) => [
      variantId,
      quantity,
    ]);

  it('gives a guest the cart of the order back, active again with its lines, once', async () => {
    const shirt = newId<'Variant'>();
    const source = await cart('CHECKED_OUT', null, [
      { variantId: shirt, quantity: 2 },
    ]);

    expect(
      await restore(null, source, [{ variantId: shirt, quantity: 2 }]),
    ).toBe('reactivated');
    expect(
      await restore(null, source, [{ variantId: shirt, quantity: 2 }]),
    ).toBe('already-restored');

    expect(await row(source)).toMatchObject({
      status: 'ACTIVE',
      version: 2,
      lastActivityAt: new Date(EXPIRED.getTime() + 1_000),
    });
    expect(await linesOf(source)).toEqual([[shirt, 2]]);
  });

  it('puts the lines of a customer’s order in the active cart, up to 30 units, and merges the cart of the order into it', async () => {
    const customer = newId<'User'>();
    const [shirt, cap] = [newId<'Variant'>(), newId<'Variant'>()];
    const own = await cart('ACTIVE', customer, [
      { variantId: shirt, quantity: 29 },
    ]);
    const source = await cart('CHECKED_OUT', customer, [
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ]);
    const lines = [
      { variantId: shirt, quantity: 2 },
      { variantId: cap, quantity: 1 },
    ];

    expect(await restore(customer, source, lines)).toBe('merged');
    expect(await restore(customer, source, lines)).toBe('already-restored');

    expect(await linesOf(own)).toEqual([
      [shirt, 30],
      [cap, 1],
    ]);
    expect(await row(source)).toMatchObject({
      status: 'MERGED',
      mergedIntoCartId: own,
    });
    expect(await linesOf(source)).toEqual([
      [shirt, 2],
      [cap, 1],
    ]);
  });

  it('gives a customer without an active cart a single active cart, whether a new line arrives before or after the restoration (BR-CRT-03)', async () => {
    const customer = newId<'User'>();
    const [shirt, cap] = [await sellable(), await sellable()];
    const source = await cart('CHECKED_OUT', customer, [
      { variantId: shirt, quantity: 2 },
    ]);
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    let results: PromiseSettledResult<unknown>[];
    try {
      // Another request of the customer holds the customer's lock: both operations wait for it.
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        CUSTOMER_CART_LOCK,
        customer,
      ]);
      const operations = [
        restore(customer, source, [{ variantId: shirt, quantity: 2 }]),
        run(() =>
          moduleRef.get(Carts).addLine({ customerId: customer }, cap, 1),
        ),
      ];
      await waitForLockWaiters(2);
      await client.query('COMMIT');
      results = await Promise.allSettled(operations);
    } finally {
      await client.end();
    }

    expect(results.map(({ status }) => status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    const active = await prisma.cart.findMany({
      where: { ownerUserId: customer, status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect((await linesOf(active[0].id as CartId)).sort()).toEqual(
      [
        [shirt, 2],
        [cap, 1],
      ].sort(),
    );
    // The restoration went first and the line went into the cart of the order, or the line opened a cart and
    // the order's lines went into it.
    const outcome = (results[0] as PromiseFulfilledResult<string>).value;
    expect((await row(source)).status).toBe(
      outcome === 'reactivated' ? 'ACTIVE' : 'MERGED',
    );
  });
});
