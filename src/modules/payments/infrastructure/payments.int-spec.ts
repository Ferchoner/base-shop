import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Money,
  newId,
  TransactionManager,
  VersionConflictError,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { PaymentsQueries } from '../application/payments.queries.js';
import { type OrderId, Payment } from '../domain/payment.js';
import { PaymentRepository } from '../domain/payment.repository.js';
import { PaymentsModule } from '../payments.module.js';

const START = new Date('2026-10-01T12:00:00.000Z');
const LATER = new Date('2026-10-01T12:30:00.000Z');

/** Payments against PostgreSQL 18 (T-190 part a, ADR-0134). */
describe('Payments: persistence (T-190)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let payments: PaymentRepository;
  let queries: PaymentsQueries;
  let transactions: TransactionManager;

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
        PaymentsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    payments = moduleRef.get(PaymentRepository);
    queries = moduleRef.get(PaymentsQueries);
    transactions = moduleRef.get(TransactionManager);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.payment.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) =>
    cls.run(() => transactions.run(work));

  const started = (amount = 19_900, orderId = newId<'Order'>()) =>
    Payment.start({
      id: newId<'Payment'>(),
      orderId,
      orderCode: 'K7M4Q9XA',
      provider: 'MANUAL',
      amount: Money.of(amount, 'MXN'),
      now: START,
    });

  async function captured(amount = 19_900): Promise<Payment> {
    const payment = started(amount);
    await run(() => payments.insert(payment, START));
    const saved = (await run(() => payments.findByOrder(payment.orderId)))!;
    saved.captureManually({
      reference: 'Ticket 00452',
      registeredBy: newId<'User'>(),
      now: LATER,
    });
    await run(() => payments.save(saved, LATER));
    return saved;
  }

  it('saves a payment with its attempts and reads it back', async () => {
    const payment = await captured();

    const read = await run(() => payments.findByOrder(payment.orderId));

    expect(read?.snapshot).toEqual({
      ...payment.snapshot,
      version: 2,
    });
    expect(read?.newAttempts).toEqual([]);
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(row).toMatchObject({
      orderCode: 'K7M4Q9XA',
      currency: 'MXN',
      capturedAmount: 19_900,
      refundedAmount: 0,
      createdAt: START,
      updatedAt: LATER,
    });
    expect(await run(() => payments.findByOrder(newId<'Order'>()))).toBeNull();
  });

  it('rejects saving a payment read at another version', async () => {
    const payment = started();
    await run(() => payments.insert(payment, START));
    const stale = Payment.restore({ ...payment.snapshot, version: 5 });
    stale.captureManually({
      reference: 'Ticket',
      registeredBy: newId<'User'>(),
      now: LATER,
    });

    await expect(run(() => payments.save(stale, LATER))).rejects.toThrow(
      new VersionConflictError(1),
    );
    expect(await prisma.paymentAttempt.count()).toBe(1);
  });

  it('reads the payments of some orders, and lists them for the staff by status, provider, order, date and amount', async () => {
    const cheap = await captured(9_900);
    const dear = await captured(29_900);
    const pending = started(19_900);
    await run(() => payments.insert(pending, START));

    const byOrder = await queries.paymentsOf([
      cheap.orderId,
      pending.orderId,
      newId<'Order'>() as OrderId,
    ]);
    const page = (
      filter: object,
      sort = [{ field: 'amount' as const, direction: 'desc' as const }],
    ) => queries.listPayments(filter, sort, { page: 1, pageSize: 20 });

    expect([...byOrder.keys()].sort()).toEqual(
      [cheap.orderId, pending.orderId].sort(),
    );
    expect(byOrder.get(pending.orderId)).toMatchObject({
      status: 'PENDING',
      capturedAt: null,
      refunds: [],
    });
    expect((await page({})).items.map(({ id }) => id)).toEqual([
      dear.id,
      pending.id,
      cheap.id,
    ]);
    expect((await page({ status: ['CAPTURED'] })).totalItems).toBe(2);
    expect((await page({ provider: ['PAYPAL'] })).totalItems).toBe(0);
    expect(
      (await page({ orderId: pending.orderId })).items.map(({ id }) => id),
    ).toEqual([pending.id]);
    expect(
      (await page({ capturedFrom: LATER, capturedTo: LATER })).totalItems,
    ).toBe(2);
    expect((await page({ capturedTo: START })).totalItems).toBe(0);
    const detail = await queries.findPayment(dear.id);
    expect(detail).toMatchObject({
      orderCode: 'K7M4Q9XA',
      version: 2,
      attempts: [{ status: 'PENDING' }, { status: 'CAPTURED' }],
    });
    expect(await queries.findPayment(newId<'Payment'>())).toBeNull();
  });
});
