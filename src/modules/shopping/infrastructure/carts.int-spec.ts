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
import {
  Clock,
  Money,
  newId,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CartViews } from '../application/cart-views.js';
import { Carts } from '../application/carts.use-case.js';
import type { CartId, VariantId } from '../domain/cart.js';
import {
  CartNotActiveError,
  LineQuantityError,
} from '../domain/cart-errors.js';
import { CartRepository } from '../domain/cart.repository.js';
import { ShoppingModule } from '../shopping.module.js';

/** The list and the warehouse their migrations create (ADR-0125, ADR-0127). */
const DEFAULT_LIST = '01a0f4f2-bb5f-770a-a269-105d21861fe0';
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d';
const START = Date.parse('2026-10-01T12:00:00.000Z');

/** Carts against PostgreSQL 18, with Catalog, Pricing and Inventory behind their facades (T-170, ADR-0131). */
describe('Shopping: carts (T-170)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let carts: Carts;
  let views: CartViews;
  // A clock that moves forward a second on each reading.
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
    carts = moduleRef.get(Carts);
    views = moduleRef.get(CartViews);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    current = START;
  });

  afterEach(async () => {
    await prisma.cartLine.deleteMany();
    // Deleting a cart also deletes the guest carts merged into it.
    await prisma.cart.deleteMany();
    await prisma.pricePeriod.deleteMany();
    await prisma.variantPrice.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.productImage.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  /**
   * A product with one variant per entry: priced unless `price` is null, with `stock` units available, and
   * published unless told otherwise.
   */
  async function product(
    entries: { price?: number | null; stock?: number; options?: object }[],
    status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED' = 'PUBLISHED',
  ): Promise<{ productId: string; slug: string; variants: VariantId[] }> {
    const productId = newId();
    const slug = `producto-${productId.slice(-12)}`;
    await prisma.product.create({
      data: { id: productId, title: 'Camisa de lino', slug, status },
    });
    const variants: VariantId[] = [];
    for (const [index, entry] of entries.entries()) {
      const id = newId<'Variant'>();
      variants.push(id);
      await prisma.productVariant.create({
        data: {
          id,
          productId,
          sku: `SKU-${id.slice(-12)}`.toUpperCase(),
          options: entry.options ?? { n: String(index) },
          status: 'ACTIVE',
        },
      });
      if (entry.price !== null) {
        await prisma.variantPrice.create({
          data: {
            id: newId(),
            priceListId: DEFAULT_LIST,
            variantId: id,
            periods: {
              create: {
                id: newId(),
                amount: entry.price ?? 10_000,
                effectiveFrom: new Date(START - 86_400_000),
                createdBy: newId(),
              },
            },
          },
        });
      }
      await prisma.stockItem.create({
        data: {
          id: newId(),
          variantId: id,
          warehouseId: MAIN,
          onHand: entry.stock ?? 0,
        },
      });
    }
    return { productId, slug, variants };
  }

  const linesOf = (id: CartId) =>
    prisma.cartLine.findMany({
      where: { cartId: id },
      orderBy: { createdAt: 'asc' },
      select: { variantId: true, quantity: true },
    });

  async function holder(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  /** Why each operation ended: `ok`, or the name of the error it threw. */
  const outcomes = (results: PromiseSettledResult<unknown>[]) =>
    results
      .map((result) =>
        result.status === 'fulfilled'
          ? 'ok'
          : (result.reason as Error).constructor.name,
      )
      .sort();

  describe('persistence', () => {
    it('keeps each line with the time it was added, writes only what changed, and counts the versions', async () => {
      const {
        variants: [shirt, cap],
      } = await product([{}, {}]);
      const id = await run(() => carts.createGuestCart());

      await run(() => carts.addLine({ guestCartId: id }, shirt, 1));
      await run(() => carts.addLine({ guestCartId: id }, cap, 2));
      const before = await prisma.cartLine.findUniqueOrThrow({
        where: { cartId_variantId: { cartId: id, variantId: shirt } },
      });
      await run(() => carts.changeLine({ guestCartId: id }, shirt, 4));
      await run(() => carts.removeLine({ guestCartId: id }, cap));

      const row = await prisma.cart.findUniqueOrThrow({ where: { id } });
      const after = await prisma.cartLine.findUniqueOrThrow({
        where: { cartId_variantId: { cartId: id, variantId: shirt } },
      });
      expect(await linesOf(id)).toEqual([{ variantId: shirt, quantity: 4 }]);
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
      // The clock moves a second on each change: created, two additions, a change and a removal.
      expect(row).toMatchObject({
        ownerUserId: null,
        status: 'ACTIVE',
        version: 5,
        createdAt: new Date(START + 1_000),
        lastActivityAt: new Date(START + 5_000),
      });
      expect(after.updatedAt).toEqual(new Date(START + 4_000));
    });

    it('reads a cart back as it was saved, without and with a lock', async () => {
      const {
        variants: [shirt],
      } = await product([{}]);
      const customer = newId<'User'>();
      const { cartId } = await run(() =>
        carts.addLine({ customerId: customer }, shirt, 3),
      );
      const repository = moduleRef.get(CartRepository);

      const found = await run(() => repository.find(cartId));
      const active = await run(() => repository.findActiveOf(customer));
      const locked = await run(() =>
        moduleRef
          .get(TransactionManager)
          .run(() => repository.lockActiveOf(customer)),
      );

      for (const cart of [found, active, locked]) {
        expect(cart).toMatchObject({
          id: cartId,
          ownerId: customer,
          status: 'ACTIVE',
          mergedIntoCartId: null,
          version: 2,
        });
        expect(cart?.lines.map(({ quantity }) => quantity)).toEqual([3]);
      }
      expect(await run(() => repository.find(newId<'Cart'>()))).toBeNull();
      expect(
        await run(() => repository.findActiveOf(newId<'User'>())),
      ).toBeNull();
    });
  });

  describe('view with Catalog, Pricing and Inventory (UC-CRT-05)', () => {
    it('shows each line with its product, main image, current price and availability', async () => {
      const { productId, slug, variants } = await product([
        { price: 59_900, stock: 2, options: { talla: 'M' } },
        { price: 19_900, stock: 0, options: { talla: 'L' } },
        { price: null, stock: 9, options: { talla: 'S' } },
      ]);
      const [medium, large, unpriced] = variants;
      const archived = await product([{ stock: 5 }], 'ARCHIVED');
      const [general, largeImage] = [newId(), newId()];
      await prisma.productImage.createMany({
        data: [
          {
            id: newId(),
            productId,
            variantId: null,
            storageKey: `products/${productId}/${general}.jpg`,
            contentType: 'image/jpeg',
            sizeBytes: 1,
            position: 2,
          },
          {
            id: newId(),
            productId,
            variantId: large,
            storageKey: `products/${productId}/${largeImage}.jpg`,
            contentType: 'image/jpeg',
            sizeBytes: 1,
            position: 3,
          },
        ],
      });
      const id = await run(() => carts.createGuestCart());
      await run(() => carts.addLine({ guestCartId: id }, medium, 2));
      await run(() => carts.addLine({ guestCartId: id }, large, 1));
      // Lines the store can no longer sell stay in the cart (ADR-0059).
      await prisma.cartLine.createMany({
        data: [unpriced, archived.variants[0]].map((variantId) => ({
          cartId: id,
          variantId,
          quantity: 1,
          createdAt: new Date(current + 60_000),
          updatedAt: new Date(current + 60_000),
        })),
      });

      const view = await views.guestCart(id);

      expect(view).toMatchObject({
        id,
        status: 'ACTIVE',
        itemCount: 5,
        subtotal: Money.of(139_700, 'MXN'),
      });
      expect(
        view.lines.map((line) => [
          line.variantId,
          line.sellable,
          line.canFulfill,
          line.unitPrice?.amount ?? null,
          line.image?.url.split('/').pop() ?? null,
        ]),
      ).toEqual([
        [medium, true, true, 59_900, `${general}.jpg`],
        [large, true, false, 19_900, `${largeImage}.jpg`],
        [unpriced, false, false, null, `${general}.jpg`],
        [archived.variants[0], false, false, null, null],
      ]);
      expect(view.lines[0]).toMatchObject({
        quantity: 2,
        options: { talla: 'M' },
        product: { id: productId, slug, title: 'Camisa de lino' },
      });
    });
  });

  describe('changes at the same time (ADR-0131)', () => {
    it('never lets a line pass 30 units when two additions race', async () => {
      const {
        variants: [shirt],
      } = await product([{}]);
      const id = await run(() => carts.createGuestCart());
      const client = await holder();
      try {
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          id,
        ]);
        const additions = [1, 2].map(() =>
          run(() => carts.addLine({ guestCartId: id }, shirt, 20)),
        );
        await waitForLockWaiters(2);
        await client.query('COMMIT');

        expect(outcomes(await Promise.allSettled(additions))).toEqual([
          LineQuantityError.name,
          'ok',
        ]);
      } finally {
        await client.end();
      }
      expect(await linesOf(id)).toEqual([{ variantId: shirt, quantity: 20 }]);
    });

    it('opens a single cart when the first two lines of a customer arrive together (BR-CRT-03)', async () => {
      const {
        variants: [shirt, cap],
      } = await product([{}, {}]);
      const customer = newId<'User'>();
      const client = await holder();
      try {
        // An active cart of the customer that another request is creating: both additions reach it together.
        await client.query(
          `INSERT INTO carts (id, owner_user_id, status, last_activity_at, version, created_at, updated_at)
           VALUES ($1, $2, 'ACTIVE', now(), 1, now(), now())`,
          [newId(), customer],
        );
        const additions = [shirt, cap].map((variantId) =>
          run(() => carts.addLine({ customerId: customer }, variantId, 1)),
        );
        await waitForLockWaiters(2);
        await client.query('ROLLBACK');

        expect(outcomes(await Promise.allSettled(additions))).toEqual([
          'ok',
          'ok',
        ]);
      } finally {
        await client.end();
      }
      const owned = await prisma.cart.findMany({
        where: { ownerUserId: customer },
      });
      expect(owned).toHaveLength(1);
      expect(
        (await linesOf(owned[0].id as CartId)).map(
          ({ variantId }) => variantId,
        ),
      ).toEqual(expect.arrayContaining([shirt, cap]));
    });

    it('merges a guest cart into one customer only, when two merge it together', async () => {
      const {
        variants: [shirt],
      } = await product([{}]);
      const guest = await run(() => carts.createGuestCart());
      await run(() => carts.addLine({ guestCartId: guest }, shirt, 2));
      const [first, second] = [newId<'User'>(), newId<'User'>()];
      const client = await holder();
      try {
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          guest,
        ]);
        const merges = [first, second].map((customer) =>
          run(() => carts.merge(customer, guest)),
        );
        await waitForLockWaiters(2);
        await client.query('COMMIT');

        expect(outcomes(await Promise.allSettled(merges))).toEqual([
          NotFoundError.name,
          'ok',
        ]);
      } finally {
        await client.end();
      }
      const owners = await prisma.cart.findMany({
        where: { ownerUserId: { in: [first, second] } },
      });
      expect(owners).toHaveLength(1);
      expect(owners[0].id).toBe(guest);
    });

    it('never loses a line added while the guest cart is merged', async () => {
      const {
        variants: [shirt, cap],
      } = await product([{}, {}]);
      const customer = newId<'User'>();
      await run(() => carts.addLine({ customerId: customer }, cap, 1));
      const guest = await run(() => carts.createGuestCart());
      await run(() => carts.addLine({ guestCartId: guest }, shirt, 1));
      const client = await holder();
      let addition: PromiseSettledResult<unknown>;
      try {
        await client.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [
          guest,
        ]);
        const operations = [
          run(() => carts.addLine({ guestCartId: guest }, shirt, 2)),
          run(() => carts.merge(customer, guest)),
        ];
        await waitForLockWaiters(2);
        await client.query('COMMIT');
        const settled = await Promise.allSettled(operations);
        addition = settled[0];
        expect(settled[1].status).toBe('fulfilled');
      } finally {
        await client.end();
      }
      const own = await views.customerCart(customer);
      const merged = own.lines.find(({ variantId }) => variantId === shirt);
      // Either the addition went first and the merge carried it, or the merge went first and it was rejected.
      if (addition.status === 'fulfilled') {
        expect(merged?.quantity).toBe(3);
      } else {
        expect(addition.reason).toBeInstanceOf(CartNotActiveError);
        expect(merged?.quantity).toBe(1);
      }
    });
  });

  it('rejects a change of a cart that an order used', async () => {
    const {
      variants: [shirt],
    } = await product([{}]);
    const id = await run(() => carts.createGuestCart());
    await prisma.cart.update({
      where: { id },
      data: { status: 'CHECKED_OUT' },
    });

    await expect(
      run(() => carts.addLine({ guestCartId: id }, shirt, 1)),
    ).rejects.toThrow(new CartNotActiveError('CHECKED_OUT'));
    expect((await views.guestCart(id)).status).toBe('CHECKED_OUT');
  });
});
