import {
  type AuditEntry,
  type AuditTrail,
  Money,
  newId,
  NotFoundError,
  type TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import {
  type NewPromotionTerms,
  Promotion,
  type PromotionId,
  type PromotionSnapshot,
  type PromotionTarget,
  type UserId,
} from '../domain/promotion.js';
import { UnusableTargetsError } from '../domain/promotion-errors.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { CreatePromotion } from './create-promotion.use-case.js';
import { EndPromotion } from './end-promotion.use-case.js';
import type { CatalogTarget, PromotionCatalog } from './promotion-ports.js';
import { PromotionReader } from './promotion-reader.js';
import type {
  PromotionQueries,
  PromotionSummaryView,
  PromotionView,
} from './promotions.queries.js';
import { UpdatePromotion } from './update-promotion.use-case.js';

const NOW = new Date('2026-10-16T18:00:00.000Z');
const LATER = new Date('2026-10-20T06:00:00.000Z');
const admin = newId<'User'>() as UserId;

const shirt: PromotionTarget = { type: 'PRODUCT', id: newId() };
const shirts: PromotionTarget = { type: 'CATEGORY', id: newId() };
const brand: PromotionTarget = { type: 'BRAND', id: newId() };
const archived: PromotionTarget = { type: 'PRODUCT', id: newId() };
const missing: PromotionTarget = { type: 'BRAND', id: newId() };

/** What Catalog has: an archived product is not in use. */
const CATALOG: readonly CatalogTarget[] = [
  { ...shirt, name: 'Camisa de lino', usable: true },
  { ...shirts, name: 'Camisas', usable: true },
  { ...brand, name: 'Lino Fino', usable: true },
  { ...archived, name: 'Camisa vieja', usable: false },
];

const TERMS: NewPromotionTerms = {
  name: 'Buen Fin 10%',
  discount: { type: 'PERCENTAGE', percentage: 10 },
  targets: [shirt, shirts],
  channels: ['ONLINE', 'STORE'],
  minimumSubtotal: Money.of(50_000, 'MXN'),
  startsAt: LATER,
  endsAt: null,
};

/** Promotions in memory, with the version check of the database. */
class InMemoryPromotions extends PromotionRepository {
  readonly stored = new Map<PromotionId, PromotionSnapshot>();
  saves = 0;
  targetWrites = 0;

  insert(promotion: Promotion): Promise<void> {
    this.stored.set(promotion.id, promotion.snapshot);
    return Promise.resolve();
  }

  find(id: PromotionId): Promise<Promotion | null> {
    const snapshot = this.stored.get(id);
    return Promise.resolve(
      snapshot === undefined ? null : Promotion.restore(snapshot),
    );
  }

  // The coupon of an order, which these use cases never reach (promotions-facade.spec.ts).
  findByCode(): Promise<Promotion | null> {
    throw new Error('Not used here');
  }

  addUse(): Promise<boolean> {
    throw new Error('Not used here');
  }

  removeUse(): Promise<void> {
    throw new Error('Not used here');
  }

  // The discount of an order, which these use cases never reach (promotions-facade.spec.ts).
  activeAt(): Promise<Promotion[]> {
    throw new Error('Not used here');
  }

  save(promotion: Promotion): Promise<void> {
    const current = this.stored.get(promotion.id)!;
    if (current.version !== promotion.version) {
      throw new VersionConflictError(current.version);
    }
    this.saves += 1;
    if (promotion.targetsChanged) this.targetWrites += 1;
    this.stored.set(promotion.id, {
      ...promotion.snapshot,
      version: current.version + 1,
    });
    return Promise.resolve();
  }
}

function setUp() {
  const calls: string[] = [];
  const asked: PromotionTarget[][] = [];
  const promotions = new InMemoryPromotions();
  const catalog: PromotionCatalog = {
    targets: (targets) => {
      asked.push([...targets]);
      return Promise.resolve(
        CATALOG.filter((entry) =>
          targets.some(
            ({ type, id }) => entry.type === type && entry.id === id,
          ),
        ),
      );
    },
    classify: () => {
      throw new Error('Not used here');
    },
  };
  const inline = {
    run: <T>(work: () => Promise<T>) => {
      calls.push('transaction');
      return work();
    },
  } as unknown as TransactionManager;
  const audited: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditTrail;
  let now = NOW;
  const clock = { now: () => now };
  return {
    calls,
    asked,
    promotions,
    audited,
    setNow: (instant: Date) => {
      now = instant;
    },
    create: new CreatePromotion(promotions, catalog, inline, audit, clock),
    update: new UpdatePromotion(promotions, catalog, inline, audit, clock),
    end: new EndPromotion(promotions, inline, audit, clock),
    catalog,
    clock,
  };
}

describe('Promotions (T-200 part a, ADR-0168)', () => {
  describe('CreatePromotion (UC-PRM-01)', () => {
    it('saves it in a transaction and audits every term from nothing', async () => {
      const { create, promotions, audited, calls, asked } = setUp();

      const id = await create.execute({ staffId: admin, terms: TERMS });

      expect(calls).toEqual(['transaction']);
      expect(asked).toEqual([[shirt, shirts]]);
      expect(promotions.stored.get(id)).toMatchObject({
        ...TERMS,
        createdBy: admin,
        version: 1,
      });
      expect(audited).toEqual([
        {
          action: 'promotions.create',
          resource: { type: 'promotion', id },
          changes: {
            name: { from: null, to: 'Buen Fin 10%' },
            percentage: { from: null, to: 10 },
            targets: {
              from: null,
              to: [
                { type: 'PRODUCT', id: shirt.id },
                { type: 'CATEGORY', id: shirts.id },
              ],
            },
            channels: { from: null, to: ['ONLINE', 'STORE'] },
            minimumSubtotal: {
              from: null,
              to: { amount: 50_000, currency: 'MXN' },
            },
            startsAt: { from: null, to: '2026-10-20T06:00:00.000Z' },
          },
        },
      ]);
    });

    it('audits an amount and the whole purchase, without asking Catalog for no targets', async () => {
      const { create, audited, asked } = setUp();

      await create.execute({
        staffId: admin,
        terms: {
          ...TERMS,
          discount: { type: 'AMOUNT', amount: Money.of(20_000, 'MXN') },
          targets: [],
          startsAt: null,
          endsAt: LATER,
        },
      });

      expect(asked).toEqual([]);
      expect(audited[0].changes).toMatchObject({
        amountOff: { from: null, to: { amount: 20_000, currency: 'MXN' } },
        startsAt: { from: null, to: '2026-10-16T18:00:00.000Z' },
        endsAt: { from: null, to: '2026-10-20T06:00:00.000Z' },
        targets: { from: null, to: [] },
      });
      expect(audited[0].changes).not.toHaveProperty('percentage');
    });

    it('creates a coupon, auditing its code and its limits of use (T-200 part c)', async () => {
      const { create, promotions, audited } = setUp();

      const id = await create.execute({
        staffId: admin,
        terms: {
          ...TERMS,
          code: 'buen-fin',
          usageLimit: 500,
          oncePerCustomer: true,
        },
      });

      expect(promotions.stored.get(id)).toMatchObject({
        code: 'BUEN-FIN',
        usageLimit: 500,
        oncePerCustomer: true,
        uses: 0,
      });
      expect(audited[0].changes).toMatchObject({
        code: { from: null, to: 'BUEN-FIN' },
        usageLimit: { from: null, to: 500 },
        oncePerCustomer: { from: null, to: true },
      });
    });

    it('refuses targets that do not exist or are not in use, naming each by its place', async () => {
      const { create, promotions, audited } = setUp();

      const failure = create.execute({
        staffId: admin,
        terms: { ...TERMS, targets: [shirt, missing, brand, archived] },
      });

      await expect(failure).rejects.toThrow(UnusableTargetsError);
      await expect(failure).rejects.toMatchObject({
        code: 'validation-error',
        details: {
          errors: [
            {
              field: 'targets[1].id',
              code: 'unknownTarget',
              message: 'No existe.',
            },
            {
              field: 'targets[3].id',
              code: 'unusableTarget',
              message:
                'No está en uso: es un producto archivado, o una categoría o marca inactiva.',
            },
          ],
        },
      });
      expect(promotions.stored.size).toBe(0);
      expect(audited).toEqual([]);
    });
  });

  describe('UpdatePromotion (UC-PRM-03)', () => {
    async function created(terms: Partial<NewPromotionTerms> = {}) {
      const context = setUp();
      const id = await context.create.execute({
        staffId: admin,
        terms: { ...TERMS, ...terms },
      });
      context.audited.length = 0;
      context.asked.length = 0;
      context.calls.length = 0;
      return { ...context, id };
    }

    it('saves and audits only what changed', async () => {
      const { update, promotions, audited, id, calls } = await created();

      await update.execute(
        id,
        {
          name: 'Buen Fin 15%',
          discount: { type: 'PERCENTAGE', percentage: 15 },
        },
        1,
      );

      expect(calls).toEqual(['transaction']);
      expect(promotions.stored.get(id)).toMatchObject({
        name: 'Buen Fin 15%',
        discount: { type: 'PERCENTAGE', percentage: 15 },
        version: 2,
      });
      expect(audited).toEqual([
        {
          action: 'promotions.update',
          resource: { type: 'promotion', id },
          changes: {
            name: { from: 'Buen Fin 10%', to: 'Buen Fin 15%' },
            percentage: { from: 10, to: 15 },
          },
        },
      ]);
    });

    it('saves nothing and audits nothing without changes', async () => {
      const { update, promotions, audited, asked, id } = await created();

      await update.execute(
        id,
        { name: 'Buen Fin 10%', targets: [shirts, shirt] },
        1,
      );

      expect(promotions.saves).toBe(0);
      expect(audited).toEqual([]);
      expect(asked).toEqual([]);
    });

    it('checks only the targets it did not have, and replaces them', async () => {
      const { update, promotions, asked, audited } = setUp();
      // Its product was archived after it was created.
      const promotion = Promotion.create({
        id: newId<'Promotion'>() as PromotionId,
        terms: { ...TERMS, targets: [shirt, archived] },
        createdBy: admin,
        at: NOW,
      });
      await promotions.insert(promotion);
      const id = promotion.id;

      await update.execute(id, { targets: [archived, brand] }, 1);

      expect(asked).toEqual([[brand]]);
      expect(promotions.targetWrites).toBe(1);
      expect(audited[0].changes).toEqual({
        targets: {
          from: [
            { type: 'PRODUCT', id: shirt.id },
            { type: 'PRODUCT', id: archived.id },
          ],
          to: [
            { type: 'PRODUCT', id: archived.id },
            { type: 'BRAND', id: brand.id },
          ],
        },
      });
    });

    it('changes the usage limit of a started coupon and audits it, refusing one below its uses (T-200 part c)', async () => {
      const { update, promotions, audited } = setUp();
      const coupon = Promotion.restore({
        ...Promotion.create({
          id: newId<'Promotion'>() as PromotionId,
          terms: { ...TERMS, code: 'HOLA', usageLimit: 10, startsAt: null },
          createdBy: admin,
          at: NOW,
        }).snapshot,
        uses: 6,
      });
      await promotions.insert(coupon);

      await update.execute(coupon.id, { usageLimit: 6 }, 1);
      await expect(
        update.execute(coupon.id, { usageLimit: 5 }, 2),
      ).rejects.toMatchObject({
        code: 'validation-error',
        details: { errors: [{ field: 'usageLimit', code: 'belowUses' }] },
      });

      expect(promotions.stored.get(coupon.id)).toMatchObject({
        usageLimit: 6,
        uses: 6,
        version: 2,
      });
      expect(audited).toEqual([
        {
          action: 'promotions.update',
          resource: { type: 'promotion', id: coupon.id },
          changes: { usageLimit: { from: 10, to: 6 } },
        },
      ]);
    });

    it('refuses a new target that is not in use', async () => {
      const { update, promotions, id } = await created();

      await expect(
        update.execute(id, { targets: [shirt, archived] }, 1),
      ).rejects.toMatchObject({
        details: {
          errors: [{ field: 'targets[1].id', code: 'unusableTarget' }],
        },
      });
      expect(promotions.saves).toBe(0);
    });

    it('refuses another version than the stored one', async () => {
      const { update, audited, id } = await created();

      await expect(
        update.execute(id, { name: 'Otra' }, 2),
      ).rejects.toMatchObject({
        code: 'version-conflict',
        details: { currentVersion: 1 },
      });
      expect(audited).toEqual([]);
    });

    it('answers a promotion that does not exist as missing', async () => {
      const { update } = setUp();
      const id = newId<'Promotion'>() as PromotionId;

      await expect(update.execute(id, { name: 'Otra' }, 1)).rejects.toThrow(
        new NotFoundError('Promotion', id),
      );
    });

    it('edits with the time of the clock', async () => {
      const { update, setNow, id } = await created();
      setNow(new Date('2026-10-21T00:00:00.000Z'));

      await expect(
        update.execute(id, { channels: ['ONLINE'] }, 1),
      ).rejects.toMatchObject({
        code: 'invalid-state-transition',
        details: { currentStatus: 'ACTIVE' },
      });
    });
  });

  describe('EndPromotion (UC-PRM-03)', () => {
    it('ends it now in a transaction and audits when', async () => {
      const { create, end, promotions, audited, calls } = setUp();
      const id = await create.execute({ staffId: admin, terms: TERMS });
      audited.length = 0;
      calls.length = 0;
      const other = newId<'User'>() as UserId;

      await end.execute({ id, staffId: other, version: 1 });

      expect(calls).toEqual(['transaction']);
      expect(promotions.stored.get(id)).toMatchObject({
        endedAt: NOW,
        endedBy: other,
        version: 2,
      });
      expect(audited).toEqual([
        {
          action: 'promotions.end',
          resource: { type: 'promotion', id },
          changes: {
            endedAt: { from: null, to: '2026-10-16T18:00:00.000Z' },
          },
        },
      ]);
    });

    it('refuses another version, and a promotion that does not exist', async () => {
      const { create, end } = setUp();
      const id = await create.execute({ staffId: admin, terms: TERMS });
      const unknown = newId<'Promotion'>() as PromotionId;

      await expect(
        end.execute({ id, staffId: admin, version: 3 }),
      ).rejects.toThrow(new VersionConflictError(1));
      await expect(
        end.execute({ id: unknown, staffId: admin, version: 1 }),
      ).rejects.toThrow(new NotFoundError('Promotion', unknown));
    });
  });

  describe('PromotionReader (UC-PRM-02)', () => {
    const id = newId<'Promotion'>() as PromotionId;
    const VIEW: PromotionView = {
      id,
      name: 'Buen Fin 10%',
      discount: { type: 'PERCENTAGE', percentage: 10 },
      targets: [shirt, missing, archived],
      channels: ['ONLINE'],
      minimumSubtotal: null,
      startsAt: LATER,
      endsAt: null,
      endedAt: null,
      endedBy: null,
      createdBy: admin,
      createdAt: NOW,
      updatedAt: NOW,
      code: null,
      usageLimit: null,
      oncePerCustomer: false,
      uses: 0,
      version: 1,
    };

    function reader(
      found: PromotionView | null,
      listed: PromotionSummaryView[] = [],
    ) {
      const listedAt: Date[] = [];
      const queries = {
        findPromotion: () => Promise.resolve(found),
        listPromotions: (
          _filter: unknown,
          _sort: unknown,
          _page: unknown,
          at: Date,
        ) => {
          listedAt.push(at);
          return Promise.resolve({ items: listed, totalItems: 7 });
        },
      } as unknown as PromotionQueries;
      const { catalog, clock } = setUp();
      return { reader: new PromotionReader(queries, catalog, clock), listedAt };
    }

    it('gives its status now and the names of its targets, null for one Catalog no longer has', async () => {
      expect(await reader(VIEW).reader.promotion(id)).toEqual({
        ...VIEW,
        status: 'SCHEDULED',
        targets: [
          { ...shirt, name: 'Camisa de lino' },
          { ...missing, name: null },
          { ...archived, name: 'Camisa vieja' },
        ],
      });
    });

    it('answers null for a promotion that does not exist', async () => {
      expect(await reader(null).reader.promotion(id)).toBeNull();
    });

    it('lists with the status of each one at the same moment', async () => {
      const summary: PromotionSummaryView = {
        id,
        name: 'Buen Fin 10%',
        discount: { type: 'PERCENTAGE', percentage: 10 },
        targetCount: 0,
        channels: ['STORE'],
        minimumSubtotal: null,
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        endsAt: null,
        endedAt: null,
        code: 'HOLA',
        usageLimit: 10,
        oncePerCustomer: true,
        uses: 3,
      };
      const { reader: read, listedAt } = reader(null, [
        summary,
        { ...summary, endedAt: NOW },
      ]);

      const page = await read.list({}, [], { page: 1, pageSize: 20 });

      expect(listedAt).toEqual([NOW]);
      expect(page).toEqual({
        items: [
          { ...summary, status: 'ACTIVE' },
          { ...summary, endedAt: NOW, status: 'ENDED' },
        ],
        totalItems: 7,
      });
    });
  });
});
