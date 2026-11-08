import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  InvalidStateTransitionError,
  newId,
  NotFoundError,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CreateWarehouse } from '../application/create-warehouse.use-case.js';
import { InventoryFacade } from '../application/inventory.facade.js';
import { StockEntries } from '../application/stock-entries.use-case.js';
import { StockLocations } from '../application/stock-locations.use-case.js';
import {
  type CountRequest,
  type StockCountId,
  StockCounts,
} from '../application/stock-counts.use-case.js';
import type { VariantId } from '../domain/stock.js';
import { CountFieldError } from '../domain/stock-count.js';
import type { WarehouseId } from '../domain/warehouse.js';
import { InventoryModule } from '../inventory.module.js';

/** The warehouse the migration creates (ADR-0127), here the store 204. */
const MAIN = '01a0f54d-639d-7173-a3ff-f510cd91429d' as WarehouseId;

/** Count sheets against PostgreSQL 18 (T-166, ADR-0173). */
describe('Inventory: count sheets (T-166)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let current: number;
  const clock = {
    now: () => {
      current += 1;
      return new Date(current);
    },
  };
  const boss = newId<'User'>();
  const counter = newId<'User'>();
  let other: WarehouseId;

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
        IdempotencyModule,
        AuditModule,
        InventoryModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  beforeEach(async () => {
    current = Date.parse('2026-11-08T18:00:00.000Z');
    other = await cls.run(() =>
      moduleRef.get(CreateWarehouse).execute({
        code: 'LOCAL-206',
        name: 'Local 206',
        address: null,
        priority: 2,
      }),
    );
  });

  afterEach(async () => {
    await prisma.reservationLine.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.stockCount.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.warehouse.deleteMany({ where: { id: { not: MAIN } } });
    await prisma.productCategory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'inventory.' } },
          { action: { startsWith: 'warehouses.' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Variants of a new product with these SKUs, straight in the Catalog tables. */
  async function createVariants(
    input: { countClass?: 'A' | 'B' | 'C'; categoryId?: string },
    ...skus: string[]
  ): Promise<VariantId[]> {
    const productId = newId();
    const ids = skus.map(() => newId<'Variant'>());
    await prisma.product.create({
      data: {
        id: productId,
        title: `Producto ${skus[0]}`,
        slug: `p-${productId}`,
        status: 'DRAFT',
        countClass: input.countClass ?? null,
      },
    });
    if (input.categoryId !== undefined) {
      await prisma.productCategory.create({
        data: { productId, categoryId: input.categoryId },
      });
    }
    await prisma.productVariant.createMany({
      data: skus.map((sku, index) => ({
        id: ids[index],
        productId,
        sku,
        options: { n: String(index) },
        status: 'ACTIVE' as const,
      })),
    });
    return ids;
  }

  const counts = () => moduleRef.get(StockCounts);
  const receiveIn = (
    warehouseId: WarehouseId,
    variantId: VariantId,
    quantity: number,
  ) =>
    cls.run(() =>
      moduleRef
        .get(StockEntries)
        .receive({ variantId, warehouseId, quantity }, boss),
    );
  /** Units that leave, like a sale, while the sheet is counted. */
  const takeOut = (variantId: VariantId, quantity: number) =>
    cls.run(() =>
      moduleRef.get(StockEntries).adjust(
        {
          variantId,
          warehouseId: MAIN,
          quantity: -quantity,
          reasonCode: 'DAMAGED',
        },
        boss,
      ),
    );
  const place = (variantId: VariantId, location: string) =>
    cls.run(() =>
      moduleRef
        .get(StockLocations)
        .set({ variantId, warehouseId: MAIN, location }),
    );
  const open = (
    request: Omit<CountRequest, 'warehouseId'>,
    warehouseId = MAIN,
  ) => cls.run(() => counts().open({ warehouseId, ...request }, boss));
  const capture = (id: StockCountId, variantId: VariantId, counted: number) =>
    cls.run(() =>
      counts().capture({
        id,
        variantId,
        counted,
        staffId: counter,
        blind: true,
      }),
    );
  const versionOf = async (id: StockCountId) =>
    (await counts().find(id, false)).version;
  const apply = async (id: StockCountId, version?: number) =>
    cls.run(async () =>
      counts().apply({
        id,
        version: version ?? (await versionOf(id)),
        staffId: boss,
      }),
    );
  const cancel = async (id: StockCountId) =>
    cls.run(async () =>
      counts().cancel({ id, version: await versionOf(id), staffId: boss }),
    );
  const onHand = async (variantId: VariantId) =>
    (
      await prisma.stockItem.findUnique({
        where: { variantId_warehouseId: { variantId, warehouseId: MAIN } },
      })
    )?.onHand ?? null;

  /** The ledger adds up to `onHand` (BR-INV-13, DATABASE.md §12). */
  async function expectLedgerBalanced(variantId: VariantId): Promise<void> {
    const items = await prisma.stockItem.findMany({ where: { variantId } });
    for (const item of items) {
      const { _sum } = await prisma.stockMovement.aggregate({
        where: { stockItemId: item.id },
        _sum: { quantity: true },
      });
      expect(_sum.quantity ?? 0).toBe(item.onHand);
    }
  }

  it('opens a sheet by location with the variants that have units or a location there, by location and SKU, with a folio and its audit', async () => {
    const [b2, a1x, a1a, empty, gone, elsewhere, none] = await createVariants(
      {},
      'B2',
      'A1-X',
      'A1-A',
      'EMPTY',
      'GONE',
      'ELSEWHERE',
      'NONE',
    );
    await receiveIn(MAIN, b2, 1);
    await receiveIn(MAIN, a1x, 3);
    await receiveIn(MAIN, a1a, 2);
    await place(b2, 'a2');
    await place(a1x, 'A1');
    await place(a1a, 'a1');
    // With a location and no units, it is counted too.
    await place(empty, 'A3');
    // Without a location it does not match a location; without units or a location, nothing matches it.
    await receiveIn(MAIN, gone, 4);
    await receiveIn(other, elsewhere, 4);

    const count = await open({ location: ' a* ', note: ' Pasillo A ' });

    expect(count).toMatchObject({
      folio: expect.stringMatching(/^C-\d{6,}$/),
      warehouseId: MAIN,
      filter: { location: 'A*' },
      note: 'Pasillo A',
      status: 'OPEN',
      blind: false,
      lineCount: 4,
      countedCount: 0,
      createdBy: boss,
      closedBy: null,
      closedAt: null,
      version: 1,
    });
    expect(
      count.lines.map(({ sku, position, location }) => [
        sku,
        position,
        location,
      ]),
    ).toEqual([
      ['A1-A', 1, 'A1'],
      ['A1-X', 2, 'A1'],
      ['B2', 3, 'A2'],
      ['EMPTY', 4, 'A3'],
    ]);
    expect(count.lines[0]).toEqual({
      variantId: a1a,
      sku: 'A1-A',
      productTitle: 'Producto B2',
      position: 1,
      location: 'A1',
      counted: null,
      countedBy: null,
      countedAt: null,
      recount: false,
      expected: null,
      difference: null,
      outcome: null,
      movementId: null,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'inventory.count-open', resourceId: count.id },
    });
    expect(audit).toMatchObject({
      resourceType: 'stock-count',
      changes: expect.objectContaining({
        folio: { from: null, to: count.folio },
        lines: { from: null, to: 4 },
      }),
    });

    // The folios are consecutive.
    const next = await open({ location: 'GONE' }).catch(
      (error: unknown) => error,
    );
    expect(next).toBeInstanceOf(CountFieldError);
    const byList = await open({ variantIds: [gone, none] });
    expect(Number(byList.folio.slice(2))).toBe(
      Number(count.folio.slice(2)) + 1,
    );
    // A listed variant is on the sheet even without units or a location; those without one go last.
    expect(byList.lines.map(({ sku }) => sku)).toEqual(['GONE', 'NONE']);
  });

  it('opens a sheet by class, with C taking the products without one, and by category', async () => {
    const { id: categoryId } = await prisma.category.create({
      data: {
        id: newId(),
        name: 'Consolas',
        slug: `consolas-${newId()}`,
        status: 'ACTIVE',
      },
    });
    const [classA] = await createVariants({ countClass: 'A' }, 'CLASS-A');
    const [classC] = await createVariants({ countClass: 'C' }, 'CLASS-C');
    const [noClass] = await createVariants({ categoryId }, 'NO-CLASS');
    const [consoleA] = await createVariants(
      { countClass: 'A', categoryId },
      'CONSOLE-A',
    );
    for (const variantId of [classA, classC, noClass, consoleA]) {
      await receiveIn(MAIN, variantId, 1);
    }

    const byClass = await open({ countClass: 'C' });
    expect(byClass.lines.map(({ sku }) => sku)).toEqual([
      'CLASS-C',
      'NO-CLASS',
    ]);
    await cancel(byClass.id);

    const byCategory = await open({ categoryId });
    expect(byCategory.lines.map(({ sku }) => sku)).toEqual([
      'CONSOLE-A',
      'NO-CLASS',
    ]);
    await cancel(byCategory.id);

    const both = await open({ categoryId, countClass: 'A' });
    expect(both.lines.map(({ sku }) => sku)).toEqual(['CONSOLE-A']);
  });

  it('keeps a variant in one open sheet per warehouse, and frees it when the sheet closes', async () => {
    const [zelda, mario] = await createVariants({}, 'ZELDA', 'MARIO');
    await receiveIn(MAIN, zelda, 2);
    await receiveIn(MAIN, mario, 2);
    await receiveIn(other, zelda, 2);
    const first = await open({ variantIds: [zelda] });

    await expect(open({ variantIds: [mario, zelda] })).rejects.toMatchObject({
      code: 'variant-in-open-count',
      details: {
        lines: [{ variantId: zelda, countId: first.id, folio: first.folio }],
      },
    });
    // Nothing of the rejected sheet stays, and another warehouse counts it apart.
    expect(await prisma.stockCount.count()).toBe(1);
    await expect(open({ variantIds: [zelda] }, other)).resolves.toMatchObject({
      lineCount: 1,
    });
    // Two sheets with the same variant at the same time: one of them.
    const results = await Promise.allSettled([
      open({ variantIds: [mario] }),
      open({ variantIds: [mario] }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);

    await cancel(first.id);
    await expect(open({ variantIds: [zelda] })).resolves.toMatchObject({
      lineCount: 1,
    });
  });

  it('answers a sheet with no lines, or a missing warehouse or variant, with nothing saved', async () => {
    const [zelda] = await createVariants({}, 'ZELDA');

    await expect(open({ location: 'Z9' })).rejects.toMatchObject({
      details: { errors: [{ field: 'location', code: 'noLines' }] },
    });
    await expect(open({ countClass: 'B' })).rejects.toMatchObject({
      details: { errors: [{ field: 'countClass', code: 'noLines' }] },
    });
    await expect(
      open({ variantIds: [zelda, newId<'Variant'>()] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      open({ variantIds: [zelda] }, newId<'Warehouse'>()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.stockCount.count()).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'inventory.count-open' },
      }),
    ).toBe(0);
  });

  it('counts blind and keeps the units on hand then, so what is sold after counting is not missing', async () => {
    const [zelda, mario, found] = await createVariants(
      {},
      'ZELDA',
      'MARIO',
      'FOUND',
    );
    await receiveIn(MAIN, zelda, 5);
    await receiveIn(MAIN, mario, 3);
    const count = await open({ variantIds: [zelda, mario] });

    const line = await capture(count.id, zelda, 4);
    expect(line).toMatchObject({
      variantId: zelda,
      counted: 4,
      countedBy: counter,
      countedAt: expect.any(Date),
      expected: null,
      difference: null,
    });
    // Two units sold after counting: the shelf had 4 of the 5 there were then.
    await takeOut(zelda, 2);
    // A variant found that was not on the sheet goes at the end.
    await capture(count.id, found, 1);

    const review = await counts().find(count.id, false);
    expect(
      review.lines.map(({ sku, position, counted, expected, difference }) => ({
        sku,
        position,
        counted,
        expected,
        difference,
      })),
    ).toEqual([
      {
        sku: 'MARIO',
        position: 1,
        counted: null,
        expected: null,
        difference: null,
      },
      { sku: 'ZELDA', position: 2, counted: 4, expected: 5, difference: -1 },
      { sku: 'FOUND', position: 3, counted: 1, expected: 0, difference: 1 },
    ]);
    expect(review).toMatchObject({ version: 3, lineCount: 3, countedCount: 2 });
    const blind = await counts().find(count.id, true);
    expect(blind.blind).toBe(true);
    expect(
      blind.lines.every(
        ({ expected, difference }) => expected === null && difference === null,
      ),
    ).toBe(true);
    // Counting is not audited.
    expect(
      await prisma.auditLog.count({ where: { resourceId: count.id } }),
    ).toBe(1);
  });

  it('asks to count a line again, over the version read', async () => {
    const [zelda] = await createVariants({}, 'ZELDA');
    await receiveIn(MAIN, zelda, 5);
    const count = await open({ variantIds: [zelda] });
    await capture(count.id, zelda, 2);

    await expect(
      cls.run(() =>
        counts().recount({ id: count.id, variantId: zelda, version: 1 }),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
    const asked = await cls.run(() =>
      counts().recount({ id: count.id, variantId: zelda, version: 2 }),
    );
    expect(asked.lines[0]).toMatchObject({
      counted: null,
      expected: null,
      countedBy: null,
      recount: true,
    });
    await expect(
      cls.run(() =>
        counts().recount({
          id: count.id,
          variantId: newId<'Variant'>(),
          version: 3,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const again = await capture(count.id, zelda, 5);
    expect(again).toMatchObject({ counted: 5, recount: false });
  });

  it('applies the differences as PHYSICAL_COUNT adjustments linked to the sheet, skips what would go below reserved, and leaves what was not counted', async () => {
    const [missing, extra, same, reserved, uncounted] = await createVariants(
      {},
      'MISSING',
      'EXTRA',
      'SAME',
      'RESERVED',
      'UNCOUNTED',
    );
    await receiveIn(MAIN, missing, 5);
    await receiveIn(MAIN, extra, 1);
    await receiveIn(MAIN, same, 2);
    await receiveIn(MAIN, reserved, 3);
    await receiveIn(MAIN, uncounted, 7);
    await cls.run(() =>
      moduleRef
        .get(InventoryFacade)
        .reserve(newId<'Order'>(), [{ variantId: reserved, quantity: 3 }]),
    );
    const count = await open({
      variantIds: [missing, extra, same, reserved, uncounted],
    });
    await capture(count.id, missing, 3);
    await capture(count.id, extra, 4);
    await capture(count.id, same, 2);
    await capture(count.id, reserved, 1);

    await expect(apply(count.id, 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    const applied = await apply(count.id);

    expect(applied).toMatchObject({
      status: 'APPLIED',
      closedBy: boss,
      closedAt: expect.any(Date),
    });
    const outcome = Object.fromEntries(
      applied.lines.map(({ sku, outcome, movementId }) => [
        sku,
        [outcome, movementId === null ? null : 'movement'],
      ]),
    );
    expect(outcome).toEqual({
      MISSING: ['ADJUSTED', 'movement'],
      EXTRA: ['ADJUSTED', 'movement'],
      SAME: ['NO_DIFFERENCE', null],
      RESERVED: ['SKIPPED_RESERVED', null],
      UNCOUNTED: ['NOT_COUNTED', null],
    });
    expect(await onHand(missing)).toBe(3);
    expect(await onHand(extra)).toBe(4);
    expect(await onHand(same)).toBe(2);
    expect(await onHand(reserved)).toBe(3);
    expect(await onHand(uncounted)).toBe(7);
    const movements = await prisma.stockMovement.findMany({
      where: { countId: count.id },
      orderBy: { quantity: 'asc' },
    });
    expect(
      movements.map(({ type, reasonCode, quantity, note, actorId }) => ({
        type,
        reasonCode,
        quantity,
        note,
        actorId,
      })),
    ).toEqual(
      [-2, 3].map((quantity) => ({
        type: 'ADJUSTMENT',
        reasonCode: 'PHYSICAL_COUNT',
        quantity,
        note: `Conteo ${count.folio}`,
        actorId: boss,
      })),
    );
    expect(applied.lines.find(({ sku }) => sku === 'MISSING')?.movementId).toBe(
      movements[0].id,
    );
    for (const variantId of [missing, extra, reserved]) {
      await expectLedgerBalanced(variantId);
    }
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'inventory.count-apply', resourceId: count.id },
    });
    expect(audit.changes).toMatchObject({
      status: { from: 'OPEN', to: 'APPLIED' },
      adjusted: { from: null, to: 2 },
      noDifference: { from: null, to: 1 },
      notCounted: { from: null, to: 1 },
      skippedReserved: { from: null, to: [reserved] },
    });

    // An applied sheet never changes, and its variants can go in another one.
    await expect(capture(count.id, missing, 1)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    await expect(apply(count.id)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    await expect(cancel(count.id)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    await expect(open({ variantIds: [missing] })).resolves.toMatchObject({
      status: 'OPEN',
    });
  });

  it('cancels a sheet with nothing adjusted, and lists the sheets newest first', async () => {
    const [zelda, mario] = await createVariants({}, 'ZELDA', 'MARIO');
    await receiveIn(MAIN, zelda, 5);
    await receiveIn(other, mario, 1);
    const first = await open({ variantIds: [zelda] });
    await capture(first.id, zelda, 1);
    const cancelled = await cancel(first.id);
    const second = await open({ variantIds: [mario] }, other);

    expect(cancelled).toMatchObject({ status: 'CANCELLED', closedBy: boss });
    expect(cancelled.lines[0]).toMatchObject({ counted: 1, outcome: null });
    expect(await onHand(zelda)).toBe(5);
    expect(
      await prisma.auditLog.count({
        where: { action: 'inventory.count-cancel', resourceId: first.id },
      }),
    ).toBe(1);

    const page = { page: 1, pageSize: 20 };
    const all = await counts().list({}, page);
    expect(all.items.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(all.items[1]).toMatchObject({
      folio: first.folio,
      status: 'CANCELLED',
      lineCount: 1,
      countedCount: 1,
    });
    expect(
      (await counts().list({ warehouseId: other }, page)).items.map(
        ({ id }) => id,
      ),
    ).toEqual([second.id]);
    expect(
      (await counts().list({ status: 'CANCELLED' }, page)).totalItems,
    ).toBe(1);
  });
});
