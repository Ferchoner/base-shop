import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  Money,
  newId,
  type SortOrder,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { CreatePromotion } from '../application/create-promotion.use-case.js';
import { EndPromotion } from '../application/end-promotion.use-case.js';
import { PromotionCatalog } from '../application/promotion-ports.js';
import {
  type PromotionFilter,
  PromotionQueries,
  type PromotionSortField,
} from '../application/promotions.queries.js';
import { UpdatePromotion } from '../application/update-promotion.use-case.js';
import {
  type NewPromotionTerms,
  Promotion,
  type PromotionId,
  type PromotionTarget,
  type UserId,
} from '../domain/promotion.js';
import { PromotionRepository } from '../domain/promotion.repository.js';
import { PromotionsModule } from '../promotions.module.js';

const NOW = new Date('2026-10-16T18:00:00.000Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

const TERMS: NewPromotionTerms = {
  name: 'Buen Fin 10%',
  discount: { type: 'PERCENTAGE', percentage: 10 },
  targets: [],
  channels: ['ONLINE', 'STORE'],
  minimumSubtotal: Money.of(50_000, 'MXN'),
  startsAt: at(24),
  endsAt: at(96),
};

/** Promotions against PostgreSQL 18 (T-200 part a, ADR-0168). */
describe('Promotions (T-200 part a)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let queries: PromotionQueries;
  let repository: PromotionRepository;
  let now = NOW;
  const admin = newId<'User'>() as UserId;
  const products: string[] = [];
  const categories: string[] = [];
  const brands: string[] = [];

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
        AppCacheModule,
        MailModule,
        EventsModule,
        AuditModule,
        PromotionsModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => now })
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    queries = moduleRef.get(PromotionQueries);
    repository = moduleRef.get(PromotionRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    now = NOW;
    await prisma.promotionTarget.deleteMany();
    await prisma.promotion.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: 'promotions.' } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: products.splice(0) } },
    });
    await prisma.category.deleteMany({
      where: { id: { in: categories.splice(0) } },
    });
    await prisma.brand.deleteMany({ where: { id: { in: brands.splice(0) } } });
  });

  /** Runs a use case in its own async context, as a request does. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  const create = (terms: Partial<NewPromotionTerms> = {}) =>
    run(() =>
      moduleRef
        .get(CreatePromotion)
        .execute({ staffId: admin, terms: { ...TERMS, ...terms } }),
    );

  async function product(
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED',
  ): Promise<PromotionTarget> {
    const id = newId();
    products.push(id);
    await prisma.product.create({
      data: { id, title: `Camisa ${status}`, slug: `camisa-${id}`, status },
    });
    return { type: 'PRODUCT', id };
  }

  async function category(
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ): Promise<PromotionTarget> {
    const id = newId();
    categories.push(id);
    await prisma.category.create({
      data: { id, name: `Camisas ${status}`, slug: `camisas-${id}`, status },
    });
    return { type: 'CATEGORY', id };
  }

  async function brand(
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ): Promise<PromotionTarget> {
    const id = newId();
    brands.push(id);
    await prisma.brand.create({
      data: { id, name: `Lino ${status}`, slug: `lino-${id}`, status },
    });
    return { type: 'BRAND', id };
  }

  describe('the catalog of its targets (ADR-0168)', () => {
    it('names the products, categories and brands that exist, and whether they are in use', async () => {
      const [draft, archived, active, inactive, used, unused] = [
        await product('DRAFT'),
        await product('ARCHIVED'),
        await category('ACTIVE'),
        await category('INACTIVE'),
        await brand('ACTIVE'),
        await brand('INACTIVE'),
      ];
      const missing: PromotionTarget = { type: 'BRAND', id: newId() };

      const found = await moduleRef
        .get(PromotionCatalog)
        .targets([draft, archived, active, inactive, used, unused, missing]);

      expect([...found].sort((a, b) => a.name.localeCompare(b.name))).toEqual(
        [
          { ...draft, name: 'Camisa DRAFT', usable: true },
          { ...archived, name: 'Camisa ARCHIVED', usable: false },
          { ...active, name: 'Camisas ACTIVE', usable: true },
          { ...inactive, name: 'Camisas INACTIVE', usable: false },
          { ...used, name: 'Lino ACTIVE', usable: true },
          { ...unused, name: 'Lino INACTIVE', usable: false },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );
    });

    it('takes an ID of a product as a product only', async () => {
      const shirt = await product();

      expect(
        await moduleRef
          .get(PromotionCatalog)
          .targets([{ type: 'BRAND', id: shirt.id }]),
      ).toEqual([]);
    });
  });

  describe('PrismaPromotionRepository', () => {
    it('saves a promotion with its targets and reads it back, products first', async () => {
      const targets = [await brand(), await category(), await product()];
      const id = await create({ targets });

      const promotion = await repository.find(id as PromotionId);

      expect(promotion?.snapshot).toEqual({
        id,
        ...TERMS,
        targets: [targets[2], targets[1], targets[0]],
        createdBy: admin,
        endedAt: null,
        endedBy: null,
        version: 1,
      });
      expect(await repository.find(newId<'Promotion'>())).toBeNull();
    });

    it('saves an amount, a single channel and no minimum or end', async () => {
      const id = await create({
        discount: { type: 'AMOUNT', amount: Money.of(20_000, 'MXN') },
        channels: ['STORE'],
        minimumSubtotal: null,
        endsAt: null,
      });

      expect((await repository.find(id))?.snapshot).toMatchObject({
        discount: { type: 'AMOUNT', amount: Money.of(20_000, 'MXN') },
        channels: ['STORE'],
        minimumSubtotal: null,
        endsAt: null,
      });
    });

    it('counts one more version, and replaces the targets only when they changed', async () => {
      const shirt = await product();
      const shirts = await category();
      const id = await create({ targets: [shirt] });

      await run(() =>
        moduleRef.get(UpdatePromotion).execute(id, { name: 'Otra' }, 1),
      );
      await run(() =>
        moduleRef.get(UpdatePromotion).execute(id, { targets: [shirts] }, 2),
      );

      expect((await repository.find(id))?.snapshot).toMatchObject({
        name: 'Otra',
        targets: [shirts],
        version: 3,
      });
      expect(
        await prisma.promotionTarget.findMany({ where: { promotionId: id } }),
      ).toEqual([
        { promotionId: id, targetType: 'CATEGORY', targetId: shirts.id },
      ]);
    });

    it('refuses to save over a version another change saved', async () => {
      const id = await create();
      const first = (await repository.find(id))!;
      const second = (await repository.find(id))!;
      first.edit({ name: 'Primera' }, NOW);
      second.edit({ name: 'Segunda' }, NOW);
      await run(() =>
        moduleRef
          .get(TransactionManager)
          .run(() => repository.save(first, NOW)),
      );

      await expect(
        run(() =>
          moduleRef
            .get(TransactionManager)
            .run(() => repository.save(second, NOW)),
        ),
      ).rejects.toThrow(new VersionConflictError(2));
      expect((await repository.find(id))?.snapshot.name).toBe('Primera');
    });

    it('keeps who ended it, with the time of the clock', async () => {
      const id = await create();
      now = at(1);

      await run(() =>
        moduleRef.get(EndPromotion).execute({ id, staffId: admin, version: 1 }),
      );

      expect(
        await prisma.promotion.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        endedAt: at(1),
        endedBy: admin,
        version: 2,
        createdAt: NOW,
        updatedAt: at(1),
      });
    });
  });

  describe('the audit', () => {
    it('records creating, editing and ending it', async () => {
      const id = await create();
      await run(() =>
        moduleRef.get(UpdatePromotion).execute(id, { name: 'Otra' }, 1),
      );
      await run(() =>
        moduleRef.get(EndPromotion).execute({ id, staffId: admin, version: 2 }),
      );

      const entries = await prisma.auditLog.findMany({
        where: { resourceId: id },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      expect(
        entries.map(({ action, resourceType }) => [action, resourceType]),
      ).toEqual([
        ['promotions.create', 'promotion'],
        ['promotions.update', 'promotion'],
        ['promotions.end', 'promotion'],
      ]);
      expect(entries[1].changes).toEqual({
        name: { from: 'Buen Fin 10%', to: 'Otra' },
      });
    });
  });

  describe('the constraints of the table', () => {
    async function insert(columns: Record<string, unknown>) {
      return prisma.promotion.create({
        data: {
          id: newId(),
          name: 'Directa',
          percentage: 10,
          amountOff: null,
          online: true,
          inStore: true,
          startsAt: NOW,
          createdBy: admin,
          updatedAt: NOW,
          ...columns,
        },
      });
    }

    it.each([
      ['promotions_discount_check', { percentage: null }],
      ['promotions_discount_check', { amountOff: 100 }],
      ['promotions_percentage_check', { percentage: 0 }],
      ['promotions_percentage_check', { percentage: 101 }],
      ['promotions_amount_off_check', { percentage: null, amountOff: 0 }],
      ['promotions_channels_check', { online: false, inStore: false }],
      ['promotions_minimum_subtotal_check', { minimumSubtotal: 0 }],
      ['promotions_dates_check', { endsAt: NOW }],
      ['promotions_ended_check', { endedAt: NOW }],
      ['promotions_ended_check', { endedBy: admin }],
    ])('enforces %s', async (constraint, columns) => {
      await expect(insert(columns)).rejects.toThrow(constraint);
    });

    it('takes a row that keeps every rule', async () => {
      await expect(
        insert({
          percentage: 100,
          online: false,
          minimumSubtotal: 1,
          endsAt: at(1),
          endedAt: NOW,
          endedBy: admin,
        }),
      ).resolves.toMatchObject({ percentage: 100 });
    });
  });

  describe('PrismaPromotionQueries (UC-PRM-02)', () => {
    const list = (
      filter: PromotionFilter = {},
      sort: SortOrder<PromotionSortField>[] = [
        { field: 'name', direction: 'asc' },
      ],
      page = { page: 1, pageSize: 20 },
    ) => queries.listPromotions(filter, sort, page, NOW);

    const namesOf = async (filter: PromotionFilter) =>
      (await list(filter)).items.map(({ name }) => name);

    /** One promotion in each place of its time at NOW, and one ended by hand before it started. */
    async function timeline() {
      await create({ name: 'Programada' });
      now = at(-5);
      await create({ name: 'Vigente', startsAt: null, endsAt: at(1) });
      await create({
        name: 'Vigente sin fin',
        startsAt: null,
        endsAt: null,
        channels: ['STORE'],
      });
      const expired = await create({
        name: 'Vencida',
        startsAt: null,
        endsAt: at(-1),
      });
      const cancelled = await create({ name: 'Cancelada', startsAt: at(10) });
      await run(() =>
        moduleRef
          .get(EndPromotion)
          .execute({ id: cancelled, staffId: admin, version: 1 }),
      );
      now = NOW;
      return { expired };
    }

    it('reads one with its targets in order', async () => {
      const targets = [await brand(), await product()];
      const id = await create({ targets });

      expect(await queries.findPromotion(id)).toEqual({
        id,
        ...TERMS,
        targets: [targets[1], targets[0]],
        endedAt: null,
        endedBy: null,
        createdBy: admin,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      });
      expect(await queries.findPromotion(newId<'Promotion'>())).toBeNull();
    });

    it('lists each one with how many targets it has', async () => {
      const id = await create({ targets: [await brand(), await product()] });

      expect(await list()).toEqual({
        items: [
          {
            id,
            name: 'Buen Fin 10%',
            discount: TERMS.discount,
            targetCount: 2,
            channels: ['ONLINE', 'STORE'],
            minimumSubtotal: Money.of(50_000, 'MXN'),
            startsAt: TERMS.startsAt,
            endsAt: TERMS.endsAt,
            endedAt: null,
          },
        ],
        totalItems: 1,
      });
    });

    it('filters by their status at the moment given', async () => {
      await timeline();
      // Ended by hand while active, without an end of its own.
      now = at(-3);
      const ended = await create({
        name: 'Terminada',
        startsAt: null,
        endsAt: null,
      });
      now = at(-2);
      await run(() =>
        moduleRef
          .get(EndPromotion)
          .execute({ id: ended, staffId: admin, version: 1 }),
      );

      expect(await namesOf({ status: ['SCHEDULED'] })).toEqual(['Programada']);
      expect(await namesOf({ status: ['ACTIVE'] })).toEqual([
        'Vigente',
        'Vigente sin fin',
      ]);
      expect(await namesOf({ status: ['ENDED'] })).toEqual([
        'Cancelada',
        'Terminada',
        'Vencida',
      ]);
      expect(await namesOf({ status: ['SCHEDULED', 'ENDED'] })).toEqual([
        'Cancelada',
        'Programada',
        'Terminada',
        'Vencida',
      ]);
    });

    it('starts one exactly at its start, and ends it exactly at its end', async () => {
      now = at(-1);
      await create({ name: 'Empieza ahora', startsAt: NOW });
      await create({ name: 'Termina ahora', startsAt: null, endsAt: NOW });
      now = NOW;

      expect(await namesOf({ status: ['SCHEDULED'] })).toEqual([]);
      expect(await namesOf({ status: ['ACTIVE'] })).toEqual(['Empieza ahora']);
      expect(await namesOf({ status: ['ENDED'] })).toEqual(['Termina ahora']);
    });

    it('filters by channel, by reach and by part of the name', async () => {
      await timeline();
      await create({
        name: 'Marca en línea',
        targets: [await brand()],
        channels: ['ONLINE'],
      });

      expect(await namesOf({ channel: 'STORE' })).toEqual([
        'Cancelada',
        'Programada',
        'Vencida',
        'Vigente',
        'Vigente sin fin',
      ]);
      expect(await namesOf({ channel: 'ONLINE' })).toEqual([
        'Cancelada',
        'Marca en línea',
        'Programada',
        'Vencida',
        'Vigente',
      ]);
      expect(await namesOf({ appliesTo: 'ITEMS' })).toEqual(['Marca en línea']);
      expect(await namesOf({ appliesTo: 'ORDER' })).toHaveLength(5);
      expect(await namesOf({ q: '  VIGENTE ' })).toEqual([
        'Vigente',
        'Vigente sin fin',
      ]);
    });

    it('sorts by start, newest first, and pages', async () => {
      await create({ name: 'Primera', startsAt: at(10) });
      await create({ name: 'Segunda', startsAt: at(20) });
      await create({ name: 'Tercera', startsAt: at(30), endsAt: at(40) });

      const page = await list({}, [{ field: 'startsAt', direction: 'desc' }], {
        page: 2,
        pageSize: 2,
      });

      expect(page.items.map(({ name }) => name)).toEqual(['Primera']);
      expect(page.totalItems).toBe(3);
    });
  });

  describe('the targets of a promotion', () => {
    it('refuses a new target that is not in use, and keeps one that stopped being in use', async () => {
      const shirt = await product();
      const id = await create({ targets: [shirt] });
      await prisma.product.update({
        where: { id: shirt.id },
        data: { status: 'ARCHIVED' },
      });
      const inactive = await brand('INACTIVE');

      await expect(
        run(() =>
          moduleRef
            .get(UpdatePromotion)
            .execute(id, { targets: [shirt, inactive] }, 1),
        ),
      ).rejects.toMatchObject({
        details: {
          errors: [{ field: 'targets[1].id', code: 'unusableTarget' }],
        },
      });
      await run(() =>
        moduleRef.get(UpdatePromotion).execute(id, { name: 'Otra' }, 1),
      );
      expect((await repository.find(id))?.snapshot.targets).toEqual([shirt]);
    });

    it('restores a promotion as it was saved', async () => {
      const id = await create({ targets: [await category()] });
      const read = (await repository.find(id))!;

      expect(Promotion.restore(read.snapshot).snapshot).toEqual(read.snapshot);
    });
  });
});
