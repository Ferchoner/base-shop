import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { waitForLockWaiters } from '../../../../test/support/lock-waiters.js';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { IdempotencyModule } from '../../../platform/http/idempotency/idempotency.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  Clock,
  Money,
  monthsBefore,
  newId,
  toId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { IdentityAccessFacade } from '../../identity-access/index.js';
import {
  Order,
  type OrderStatus,
  priceLine,
} from '../../ordering/domain/order.js';
import { OrderRepository } from '../../ordering/domain/order.repository.js';
import { newPublicCode } from '../../ordering/domain/public-code.js';
import {
  INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS,
  InactiveCustomerAnonymizations,
  INACTIVITY_REASON,
} from '../application/inactive-customer-anonymizations.js';
import { PrivacyModule } from '../privacy.module.js';

const START = Date.parse('2027-10-31T09:00:00.000Z');
/** `months` calendar months before the run, as the anonymization counts them. */
const ago = (months: number) => monthsBefore(new Date(START), months);

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: '4B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: 'Entre Galeana e Hidalgo',
};

/**
 * The anonymization of inactive customers against PostgreSQL 18 (T-232, ADR-0152), across Identity & Access, Ordering
 * and Shopping, with a period of 24 months.
 */
describe('Privacy: inactive customers (T-232)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
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
        RateLimitingModule,
        IdempotencyModule,
        MailModule,
        AuditModule,
        PrivacyModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS)
      .useValue(24)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    await prisma.geoState.upsert({
      where: { code: '16' },
      create: { code: '16', name: 'Michoacán de Ocampo' },
      update: {},
    });
    await prisma.geoMunicipality.upsert({
      where: { code: '16053' },
      create: {
        code: '16053',
        stateCode: '16',
        name: 'Morelia',
        isActive: true,
      },
      update: {},
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    current = START;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'customers.anonymize' },
    });
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.customerAddress.deleteMany();
    await prisma.user.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);
  const anonymizeInactive = () =>
    run(() => moduleRef.get(InactiveCustomerAnonymizations).run());

  /** A customer last active at `lastActiveAt`, with a session, two links, a saved address and a cart. */
  async function customer(
    lastActiveAt: Date,
    options: { type?: 'CUSTOMER' | 'STAFF'; status?: 'SUSPENDED' } = {},
  ): Promise<string> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: options.type ?? 'CUSTOMER',
        status: options.status ?? 'ACTIVE',
        suspendedAt: options.status === undefined ? null : lastActiveAt,
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: ago(80),
        privacyNoticeVersion: '2026-09',
        createdAt: ago(80),
        lastLoginAt: lastActiveAt,
        lastActiveAt,
      },
    });
    const expiresAt = new Date(START + 86_400_000);
    await prisma.refreshToken.create({
      data: {
        id: newId(),
        userId: id,
        sessionId: newId(),
        tokenHash: `refresh-${id}`,
        expiresAt,
      },
    });
    await prisma.emailVerificationToken.create({
      data: {
        id: newId(),
        userId: id,
        email: `nuevo-${id}@example.com`,
        tokenHash: `verification-${id}`,
        expiresAt,
      },
    });
    await prisma.passwordResetToken.create({
      data: { id: newId(), userId: id, tokenHash: `reset-${id}`, expiresAt },
    });
    if (options.type !== 'STAFF') {
      await prisma.customerAddress.create({
        data: { id: newId(), userId: id, ...ADDRESS, isDefault: true },
      });
      await prisma.cart.create({
        data: {
          id: newId(),
          ownerUserId: id,
          status: 'ACTIVE',
          lastActivityAt: lastActiveAt,
          lines: { create: [{ variantId: newId(), quantity: 1 }] },
        },
      });
    }
    return id;
  }

  /** An order of the customer in `status`, concluded at `concludedAt`. */
  async function order(
    customerId: string,
    status: OrderStatus,
    concludedAt: Date | null,
  ): Promise<string> {
    const placed = Order.place({
      id: newId<'Order'>(),
      publicCode: newPublicCode(),
      buyer: {
        customerId: toId<'User'>(customerId),
        contactEmail: `${customerId}@example.com`,
      },
      lines: [
        priceLine(
          {
            variantId: newId<'Variant'>(),
            sku: 'CAM-M',
            productName: 'Camisa de lino',
            variantOptions: { talla: 'M' },
            unitPrice: Money.of(10_000, 'MXN'),
            quantity: 1,
          },
          1600,
        ),
      ],
      shipping: {
        cost: Money.of(9_900, 'MXN'),
        taxAmount: Money.of(1_366, 'MXN'),
        taxRateBp: 1600,
        deliveryMinBusinessDays: 3,
        deliveryMaxBusinessDays: 7,
      },
      shippingAddress: {
        ...ADDRESS,
        stateName: 'Michoacán de Ocampo',
        municipalityName: 'Morelia',
        country: 'MX',
      },
      reservation: { id: newId<'Reservation'>(), expiresAt: ago(30) },
      sourceCartId: newId<'Cart'>(),
      now: ago(30),
    });
    await run(() =>
      moduleRef
        .get(TransactionManager)
        .run(() => moduleRef.get(OrderRepository).insert(placed)),
    );
    const { id } = placed.snapshot;
    await prisma.order.update({
      where: { id },
      data: {
        status,
        paidAt: ago(30),
        deliveredAt: status === 'DELIVERED' ? concludedAt : null,
        concludedAt,
      },
    });
    return id;
  }

  /** What the customer keeps: the account, its sessions, links, addresses and carts. */
  async function tracesOf(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, email: true, firstNames: true, version: true },
    });
    return {
      user,
      sessions: await prisma.refreshToken.count({ where: { userId } }),
      links:
        (await prisma.emailVerificationToken.count({ where: { userId } })) +
        (await prisma.passwordResetToken.count({ where: { userId } })),
      addresses: await prisma.customerAddress.count({ where: { userId } }),
      carts: await prisma.cart.count({ where: { ownerUserId: userId } }),
    };
  }

  it('anonymizes the customers inactive for 24 months, also suspended, with their sessions, links, addresses and carts, audited as the system', async () => {
    const idle = await customer(ago(25));
    const suspended = await customer(ago(30), { status: 'SUSPENDED' });
    const recent = await customer(ago(23));
    const staff = await customer(ago(40), { type: 'STAFF' });

    expect(await anonymizeInactive()).toEqual({
      anonymized: 2,
      skipped: 0,
      failed: 0,
    });

    for (const id of [idle, suspended]) {
      expect(await tracesOf(id)).toEqual({
        user: {
          status: 'ANONYMIZED',
          email: null,
          firstNames: null,
          version: 2,
        },
        sessions: 0,
        links: 0,
        addresses: 0,
        carts: 0,
      });
    }
    for (const id of [recent, staff]) {
      expect((await tracesOf(id)).user).toMatchObject({
        email: `${id}@example.com`,
        version: 1,
      });
    }
    expect(
      (
        await prisma.auditLog.findMany({
          where: { action: 'customers.anonymize' },
          orderBy: { resourceId: 'asc' },
        })
      ).map(({ actorType, actorId, resourceId, changes, reason }) => ({
        actorType,
        actorId,
        resourceId,
        changes,
        reason,
      })),
    ).toEqual(
      [idle, suspended].sort().map((id) => ({
        actorType: 'SYSTEM',
        actorId: null,
        resourceId: id,
        changes: {
          status: {
            from: id === idle ? 'ACTIVE' : 'SUSPENDED',
            to: 'ANONYMIZED',
          },
          email: { changed: true },
          firstNames: { changed: true },
          lastNames: { changed: true },
          passwordHash: { changed: true },
        },
        reason: INACTIVITY_REASON,
      })),
    );

    expect(await anonymizeInactive()).toEqual({
      anonymized: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('leaves the concluded orders of an inactive customer to their own retention cycle', async () => {
    const idle = await customer(ago(25));
    const delivered = await order(idle, 'DELIVERED', ago(26));

    await anonymizeInactive();

    expect(
      await prisma.order.findUniqueOrThrow({
        where: { id: delivered },
        select: {
          customerId: true,
          contactEmail: true,
          anonymizedAt: true,
          blockedAt: true,
        },
      }),
    ).toEqual({
      customerId: idle,
      contactEmail: `${idle}@example.com`,
      anonymizedAt: null,
      blockedAt: null,
    });
  });

  it('skips a customer with an order that has not concluded, and keeps everything of theirs', async () => {
    const buying = await customer(ago(25));
    await order(buying, 'PAID', null);
    const before = await tracesOf(buying);

    expect(await anonymizeInactive()).toEqual({
      anonymized: 0,
      skipped: 1,
      failed: 0,
    });

    expect(await tracesOf(buying)).toEqual(before);
    expect(
      await prisma.auditLog.count({ where: { action: 'customers.anonymize' } }),
    ).toBe(0);
  });

  it('answers the inactive customers least recently active first, up to a limit, also on the cutoff itself', async () => {
    const oldest = await customer(ago(40));
    const onCutoff = await customer(ago(24));
    await customer(ago(23));
    await customer(ago(50), { type: 'STAFF' });
    const anonymized = await customer(ago(60));
    await prisma.user.update({
      where: { id: anonymized },
      data: { status: 'ANONYMIZED', email: null, anonymizedAt: ago(1) },
    });
    const identity = moduleRef.get(IdentityAccessFacade);

    expect(await identity.inactiveCustomers(ago(24), 1_000)).toEqual([
      oldest,
      onCutoff,
    ]);
    expect(await identity.inactiveCustomers(ago(24), 1)).toEqual([oldest]);
  });

  it('waits for a customer signing in meanwhile, and then finds them active', async () => {
    const idle = await customer(ago(25));
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    let result: unknown;
    try {
      await client.query('BEGIN');
      // A sign-in records the activity of the account.
      await client.query(
        'UPDATE users SET last_active_at = now() WHERE id = $1',
        [idle],
      );
      const anonymizing = anonymizeInactive();
      await waitForLockWaiters(1);
      await client.query('COMMIT');
      result = await anonymizing;
    } finally {
      await client.end();
    }

    expect(result).toEqual({ anonymized: 0, skipped: 0, failed: 0 });
    expect((await tracesOf(idle)).user).toMatchObject({ status: 'ACTIVE' });
  });

  it('anonymizes no customer active again since the cutoff, staff, nor one already anonymized, when it locks them', async () => {
    const recent = await customer(ago(23));
    const staff = await customer(ago(40), { type: 'STAFF' });
    const anonymized = await customer(ago(60));
    await prisma.user.update({
      where: { id: anonymized },
      data: { status: 'ANONYMIZED', email: null, anonymizedAt: ago(1) },
    });
    const identity = moduleRef.get(IdentityAccessFacade);

    for (const id of [recent, staff, anonymized, newId()]) {
      expect(
        await run(() =>
          identity.anonymizeInactiveCustomer({
            userId: toId<'User'>(id),
            inactiveSince: ago(24),
            reason: INACTIVITY_REASON,
            at: new Date(START),
          }),
        ),
      ).toBe(false);
    }
    expect(
      await prisma.auditLog.count({ where: { action: 'customers.anonymize' } }),
    ).toBe(0);
  });
});
