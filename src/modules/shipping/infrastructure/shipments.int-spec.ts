import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  newId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import {
  type NewShipment,
  ShippingFacade,
} from '../application/shipping.facade.js';
import { ShippingQueries } from '../application/shipping.queries.js';
import type { OrderId, ShipmentAddress } from '../domain/shipment.js';
import { ShipmentRepository } from '../domain/shipment.repository.js';
import { ShippingModule } from '../shipping.module.js';

const START = Date.parse('2026-10-02T12:00:00.000Z');
const MINUTE = 60_000;

const ADDRESS: ShipmentAddress = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: 'B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  stateName: 'Michoacán de Ocampo',
  municipalityCode: '16053',
  municipalityName: 'Morelia',
  city: null,
  references: 'Frente a la catedral',
  country: 'MX',
};

/** Shipments against PostgreSQL 18 (T-195 part a, ADR-0140). */
describe('Shipping: shipments (T-195)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let facade: ShippingFacade;
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
        AuditModule,
        ShippingModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    facade = moduleRef.get(ShippingFacade);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    current = START;
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) =>
    cls.run(() => moduleRef.get(TransactionManager).run(work));

  /** A new shipment of an order of two lines, the second one placed first. */
  function shipmentOf(orderId = newId<'Order'>(), orderCode = 'K7M4Q9XA') {
    const [first, second] = [newId<'OrderLine'>(), newId<'OrderLine'>()];
    const input: NewShipment = {
      orderId,
      orderCode,
      warehouseId: newId<'Warehouse'>(),
      destination: ADDRESS,
      items: [
        {
          orderLineId: second,
          sku: 'GOR-U',
          productName: 'Gorra',
          quantity: 1,
        },
        {
          orderLineId: first,
          sku: 'CAM-M',
          productName: 'Camisa de lino',
          quantity: 2,
        },
      ],
    };
    return input;
  }

  const lock = (orderId: OrderId) =>
    run(() => moduleRef.get(ShipmentRepository).lockByOrder(orderId));

  it('saves a shipment with its items, in the order of their lines, once per order (BR-SHP-02)', async () => {
    const input = shipmentOf();

    await run(() => facade.createShipment(input));
    await run(() => facade.createShipment(input));

    const shipment = (await lock(input.orderId))!;
    expect(shipment.snapshot).toEqual({
      id: expect.any(String),
      orderId: input.orderId,
      orderCode: 'K7M4Q9XA',
      warehouseId: input.warehouseId,
      status: 'PENDING',
      destination: ADDRESS,
      items: [input.items[1], input.items[0]],
      carrierName: null,
      trackingNumber: null,
      ownDelivery: false,
      dispatchedAt: null,
      deliveredAt: null,
      failedAt: null,
      returnedAt: null,
      cancelledAt: null,
      version: 1,
    });
    expect(await prisma.shipment.count()).toBe(1);
    expect(
      await prisma.shipment.findFirstOrThrow({
        select: { createdAt: true, updatedAt: true },
      }),
    ).toEqual({
      createdAt: new Date(START + 1_000),
      updatedAt: new Date(START + 1_000),
    });
  });

  it('records the tracking and cancels a shipment, comparing its version', async () => {
    const recorded = shipmentOf();
    const cancelled = shipmentOf();
    await run(() => facade.createShipment(recorded));
    await run(() => facade.createShipment(cancelled));
    const repository = moduleRef.get(ShipmentRepository);

    await run(async () => {
      const shipment = (await repository.lockByOrder(recorded.orderId))!;
      shipment.recordTracking('Estafeta', 'EST-0001');
      await repository.save(shipment, new Date(START + MINUTE));
    });
    await run(() => facade.cancelShipmentOf(cancelled.orderId));
    await run(() => facade.cancelShipmentOf(newId<'Order'>()));
    const stale = (await lock(recorded.orderId))!;
    const outdated = await run(async () => {
      const shipment = (await repository.lockByOrder(recorded.orderId))!;
      shipment.recordTracking('DHL', 'DHL-0002');
      await repository.save(shipment, new Date(START + MINUTE));
      return stale;
    });
    outdated.recordTracking('Redpack', 'RED-0003');

    await expect(
      run(() => repository.save(outdated, new Date(START + 2 * MINUTE))),
    ).rejects.toThrow(new VersionConflictError(3));
    expect((await lock(recorded.orderId))!.snapshot).toMatchObject({
      carrierName: 'DHL',
      trackingNumber: 'DHL-0002',
      version: 3,
    });
    expect((await lock(cancelled.orderId))!.snapshot).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: expect.any(Date),
      version: 2,
    });
  });

  it('keeps a cancelled shipment with its date and without dispatch, as the database requires (ADR-0140)', async () => {
    const input = shipmentOf();
    await run(() => facade.createShipment(input));

    await expect(
      prisma.$executeRaw`UPDATE shipments SET status = 'CANCELLED' WHERE order_id = ${input.orderId}::uuid`,
    ).rejects.toThrow(/shipments_cancelled_at_check/);
    await expect(
      prisma.$executeRaw`UPDATE shipments SET status = 'DISPATCHED', own_delivery = true WHERE order_id = ${input.orderId}::uuid`,
    ).rejects.toThrow(/shipments_dispatched_at_check/);
    await prisma.$executeRaw`UPDATE shipments SET status = 'CANCELLED', cancelled_at = now() WHERE order_id = ${input.orderId}::uuid`;
  });

  it('lists shipments for the staff by status, order, code or tracking number and date, and reads those of some orders', async () => {
    const [first, second, third] = [
      shipmentOf(newId<'Order'>(), 'AAAA1111'),
      shipmentOf(newId<'Order'>(), 'BBBB2222'),
      shipmentOf(newId<'Order'>(), 'CCCC3333'),
    ];
    for (const input of [first, second, third]) {
      await run(() => facade.createShipment(input));
    }
    const repository = moduleRef.get(ShipmentRepository);
    await run(async () => {
      const shipment = (await repository.lockByOrder(second.orderId))!;
      shipment.recordTracking('Estafeta', 'EST-0001');
      await repository.save(shipment, new Date(START + MINUTE));
    });
    await run(() => facade.cancelShipmentOf(third.orderId));
    const queries = moduleRef.get(ShippingQueries);
    const codes = async (
      filter: object,
      sort: 'asc' | 'desc' = 'asc',
    ): Promise<string[]> =>
      (
        await queries.listShipments(
          filter,
          [{ field: 'createdAt', direction: sort }],
          { page: 1, pageSize: 20 },
        )
      ).items.map(({ orderCode }) => orderCode);

    expect(await codes({ status: ['PENDING'] })).toEqual([
      'AAAA1111',
      'BBBB2222',
    ]);
    expect(await codes({}, 'desc')).toEqual([
      'CCCC3333',
      'BBBB2222',
      'AAAA1111',
    ]);
    expect(await codes({ status: ['CANCELLED'] })).toEqual(['CCCC3333']);
    expect(await codes({ orderId: first.orderId })).toEqual(['AAAA1111']);
    expect(await codes({ q: 'bbbb-2222' })).toEqual(['BBBB2222']);
    expect(await codes({ q: ' est-0001 ' })).toEqual(['BBBB2222']);
    expect(await codes({ q: 'ZZZZ-ZZZZ' })).toEqual([]);
    expect(
      await codes({
        createdFrom: new Date(START + 2_000),
        createdTo: new Date(START + 2_000),
      }),
    ).toEqual(['BBBB2222']);
    const page = await queries.listShipments(
      {},
      [{ field: 'createdAt', direction: 'asc' }],
      { page: 2, pageSize: 2 },
    );
    expect([page.totalItems, page.items.length]).toEqual([3, 1]);

    const ofOrders = await facade.shipmentsOf([
      first.orderId,
      second.orderId,
      newId<'Order'>(),
    ]);
    expect([...ofOrders.keys()].sort()).toEqual(
      [first.orderId, second.orderId].sort(),
    );
    expect(ofOrders.get(second.orderId)).toEqual({
      id: (await lock(second.orderId))!.id,
      status: 'PENDING',
      carrierName: 'Estafeta',
      trackingNumber: 'EST-0001',
      ownDelivery: false,
      dispatchedAt: null,
      deliveredAt: null,
      version: 2,
    });
    expect(await facade.shipmentsOf([])).toEqual(new Map());
    const detail = await queries.findShipment((await lock(first.orderId))!.id);
    expect(detail).toMatchObject({
      orderCode: 'AAAA1111',
      items: [first.items[1], first.items[0]],
      createdAt: new Date(START + 1_000),
    });
    expect(await queries.findShipment(newId<'Shipment'>())).toBeNull();
  });
});
