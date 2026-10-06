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
import {
  type OrderId,
  Payment,
  type PaymentMethod,
} from '../domain/payment.js';
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

  async function captured(
    amount = 19_900,
    method: PaymentMethod | null = null,
  ): Promise<Payment> {
    const payment = started(amount);
    await run(() => payments.insert(payment, START));
    const saved = (await run(() => payments.findByOrder(payment.orderId)))!;
    saved.captureManually({
      reference: 'Ticket 00452',
      method,
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

  it('keeps how the store collected a manual payment, and shows it with the payment (ADR-0161)', async () => {
    const transfer = await captured(19_900, 'TRANSFER');
    const unsaid = await captured(9_900);

    const read = await run(() => payments.findByOrder(transfer.orderId));
    expect(
      read?.snapshot.attempts.map(({ status, method }) => [status, method]),
    ).toEqual([
      ['PENDING', null],
      ['CAPTURED', 'TRANSFER'],
    ]);
    const byOrder = await queries.paymentsOf([
      transfer.orderId,
      unsaid.orderId,
    ]);
    expect(byOrder.get(transfer.orderId)?.method).toBe('TRANSFER');
    expect(byOrder.get(unsaid.orderId)?.method).toBeNull();
    expect(
      (await queries.findPayment(transfer.id))?.attempts.map(
        ({ method }) => method,
      ),
    ).toEqual([null, 'TRANSFER']);
    // Only a captured attempt tells how the money came in.
    await expect(
      prisma.$executeRaw`UPDATE payment_attempts SET method = 'CASH' WHERE status = 'PENDING'`,
    ).rejects.toThrow(/payment_attempts_method_check/);
  });

  it('rejects saving a payment read at another version', async () => {
    const payment = started();
    await run(() => payments.insert(payment, START));
    const stale = Payment.restore({ ...payment.snapshot, version: 5 });
    stale.captureManually({
      reference: 'Ticket',
      method: null,
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

  it('saves the refunds of a payment as they start and complete, and locks the payment by id (ADR-0135)', async () => {
    const DONE = new Date('2026-10-01T13:00:00.000Z');
    const payment = await captured();
    const refundId = newId<'Refund'>();
    const staff = newId<'User'>();
    await run(async () => {
      const locked = (await payments.lock(payment.id))!;
      locked.startRefund(refundId, LATER);
      await payments.save(locked, LATER);
    });
    const pending = await prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
    });

    await run(async () => {
      const locked = (await payments.lock(payment.id))!;
      locked.completeManualRefund({
        reference: 'Devolución 00087',
        registeredBy: staff,
        now: DONE,
      });
      await payments.save(locked, DONE);
    });
    // An older refund that failed stays as history, and is read first although it was written last.
    const failed = newId();
    await prisma.refund.create({
      data: {
        id: failed,
        paymentId: payment.id,
        amount: 19_900,
        status: 'FAILED',
        createdAt: START,
        updatedAt: START,
      },
    });

    expect(pending).toMatchObject({
      paymentId: payment.id,
      amount: 19_900,
      status: 'PENDING',
      providerRefundId: null,
      registeredBy: null,
      createdAt: LATER,
      updatedAt: LATER,
      completedAt: null,
    });
    const read = (await run(() => payments.findByOrder(payment.orderId)))!;
    expect(read.snapshot).toMatchObject({
      status: 'REFUNDED',
      refundedAmount: Money.of(19_900, 'MXN'),
      version: 4,
    });
    expect(read.snapshot.refunds).toEqual([
      expect.objectContaining({ id: failed, status: 'FAILED' }),
      {
        id: refundId,
        amount: Money.of(19_900, 'MXN'),
        status: 'COMPLETED',
        providerRefundId: 'Devolución 00087',
        registeredBy: staff,
        createdAt: LATER,
        completedAt: DONE,
      },
    ]);
    expect(read.touchedRefunds).toEqual([]);
    expect(
      await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }),
    ).toMatchObject({ createdAt: LATER, updatedAt: DONE });
    expect(
      (await queries.findPayment(payment.id))?.refunds.map(({ id }) => id),
    ).toEqual([failed, refundId]);
    expect(await run(() => payments.lock(newId<'Payment'>()))).toBeNull();
  });
});
