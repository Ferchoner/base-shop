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
import { CartCopies } from '../application/cart-copies.js';
import { Carts } from '../application/carts.use-case.js';
import type { CartId, CustomerId, VariantId } from '../domain/cart.js';
import { ShoppingModule } from '../shopping.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-01T12:00:00.000Z');
/** Class of the advisory locks of customers' carts (ADR-0131). */
const CUSTOMER_CART_LOCK = 0x43415254;

/** Orders bought again into carts, against PostgreSQL 18 (T-181 part b, ADR-0139). */
describe('Shopping: carts of reorders (T-181)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let copies: CartCopies;
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
    copies = moduleRef.get(CartCopies);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    current = START;
  });

  afterEach(async () => {
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  /** A variant of a published product, priced and with stock: sold now unless `status` says otherwise. */
  async function variant(
    status: 'ACTIVE' | 'DISCONTINUED' = 'ACTIVE',
  ): Promise<VariantId> {
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
            status,
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

  /** A guest cart that an order used. */
  async function checkedOut(
    lines: { variantId: VariantId; quantity: number }[],
  ): Promise<CartId> {
    const id = newId<'Cart'>();
    await prisma.cart.create({
      data: {
        id,
        status: 'CHECKED_OUT',
        lastActivityAt: new Date(START),
        createdAt: new Date(START),
        updatedAt: new Date(START),
        lines: {
          create: lines.map((line, index) => ({
            ...line,
            createdAt: new Date(START - 1_000 + index),
            updatedAt: new Date(START),
          })),
        },
      },
    });
    return id;
  }

  const linesOf = async (id: CartId) =>
    (
      await prisma.cartLine.findMany({
        where: { cartId: id },
        orderBy: { createdAt: 'asc' },
      })
    ).map(({ variantId, quantity }) => [variantId, quantity]);

  it('reopens the cart of a guest order with only the lines sold now, and adds to it after that', async () => {
    const [shirt, retired] = [await variant(), await variant('DISCONTINUED')];
    const lines = [
      { variantId: shirt, quantity: 2 },
      { variantId: retired, quantity: 1 },
    ];
    const source = await checkedOut(lines);

    expect(await run(() => copies.toSourceCart(source, lines))).toEqual({
      cartId: source,
      skippedVariantIds: [retired],
    });
    expect(
      await prisma.cart.findUniqueOrThrow({ where: { id: source } }),
    ).toMatchObject({ status: 'ACTIVE', version: 2 });
    expect(await linesOf(source)).toEqual([[shirt, 2]]);

    await run(() => copies.toSourceCart(source, lines));

    expect(await linesOf(source)).toEqual([[shirt, 4]]);
  });

  it('gives a customer without an active cart a single active cart, whether a new line arrives before or after the copy (BR-CRT-03)', async () => {
    const customer = newId<'User'>() as CustomerId;
    const [shirt, cap] = [await variant(), await variant()];
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
        run(() =>
          copies.toCustomerCart(customer, [{ variantId: shirt, quantity: 2 }]),
        ),
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
    const owned = await prisma.cart.findMany({
      where: { ownerUserId: customer },
    });
    expect(owned.map(({ status }) => status)).toEqual(['ACTIVE']);
    expect((await linesOf(owned[0].id as CartId)).sort()).toEqual(
      [
        [shirt, 2],
        [cap, 1],
      ].sort(),
    );
  });
});
