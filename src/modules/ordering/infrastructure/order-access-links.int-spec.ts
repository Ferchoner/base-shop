import { createHash } from 'node:crypto';
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
  type EmailMessage,
  EmailSender,
  InvalidOrExpiredTokenError,
  Money,
  newId,
  toId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { SpentAccessTokens } from '../application/access-token-cleanup.js';
import { OrderAccessLinks } from '../application/order-access-links.js';
import { OrderAnonymizations } from '../application/order-anonymizations.use-case.js';
import { OrderingQueries } from '../application/ordering.queries.js';
import { Order, priceLine } from '../domain/order.js';
import { OrderRepository } from '../domain/order.repository.js';
import { newPublicCode } from '../domain/public-code.js';
import { OrderingModule } from '../ordering.module.js';
import { ORDER_ACCESS_LOCK } from './prisma-order-access-token.repository.js';

const START = Date.parse('2026-10-03T12:00:00.000Z');
const EMAIL = 'cliente@example.com';
const THIRTY_MINUTES = 30 * 60_000;

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  stateName: 'Michoacán de Ocampo',
  municipalityCode: '16053',
  municipalityName: 'Morelia',
  city: null,
  references: null,
  country: 'MX',
} as const;

/** Keeps the emails instead of sending them. */
class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The token of the last access link sent to `to`. */
  lastToken(to: string): string {
    const message = this.sent.filter((sent) => sent.to === to).at(-1);
    const token = /order-access\?token=([\w-]+)/.exec(message?.text ?? '');
    if (token === null) throw new Error(`No access link to ${to}`);
    return token[1];
  }
}

/** The access links to the guest orders of an email against PostgreSQL 18 (T-186, UC-ORD-05, ADR-0148). */
describe('Ordering: access links to the guest orders (T-186)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let links: OrderAccessLinks;
  // A clock the tests move by hand.
  let now = START;
  const email = new RecordingEmailSender();

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
        OrderingModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(now) })
      .overrideProvider(EmailSender)
      .useValue(email)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    links = moduleRef.get(OrderAccessLinks);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    now = START;
  });

  afterEach(async () => {
    email.sent.length = 0;
    await prisma.auditLog.deleteMany({
      where: { action: 'orders.anonymize' },
    });
    await prisma.orderAccessToken.deleteMany();
    await prisma.orderStatusHistory.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);
  const issue = (contactEmail = EMAIL) => run(() => links.issue(contactEmail));
  const redeem = (token: string) => run(() => links.redeem(token));
  const sha256 = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  /** An order of one shirt, placed `minutesAgo` minutes ago, by a guest or a customer. */
  async function order(
    buyer: { guestEmail: string } | { customerId: string; email: string },
    minutesAgo = 60,
  ): Promise<string> {
    const placed = Order.place({
      id: newId<'Order'>(),
      publicCode: newPublicCode(),
      buyer:
        'guestEmail' in buyer
          ? {
              customerId: null,
              contactEmail: buyer.guestEmail,
              privacyNoticeVersion: '2026-09',
            }
          : {
              customerId: toId<'User'>(buyer.customerId),
              contactEmail: buyer.email,
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
      shippingAddress: ADDRESS,
      reservation: {
        id: newId<'Reservation'>(),
        expiresAt: new Date(START - minutesAgo * 60_000 + 1_200_000),
      },
      sourceCartId: newId<'Cart'>(),
      now: new Date(START - minutesAgo * 60_000),
    });
    await run(() =>
      moduleRef
        .get(TransactionManager)
        .run(() => moduleRef.get(OrderRepository).insert(placed)),
    );
    return placed.snapshot.publicCode;
  }

  /** Another connection, in a transaction, to hold a lock while a test lines up what waits for it. */
  async function holder(): Promise<pg.Client> {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('BEGIN');
    return client;
  }

  /** Expires the guest orders of the email and anonymizes them, as Privacy does (ADR-0145). */
  async function anonymizeGuest(publicCode: string): Promise<number> {
    await prisma.order.updateMany({
      where: { contactEmail: EMAIL },
      data: { status: 'EXPIRED', expiredAt: new Date(START - 60_000) },
    });
    return run(() =>
      moduleRef.get(OrderAnonymizations).anonymize({
        buyer: { contactEmail: EMAIL, publicCode },
        reason: 'ARCO-2026-0043',
        at: new Date(now),
      }),
    );
  }

  describe('issuing', () => {
    it('stores only the hash of the token, for 30 minutes, and sends the link to the email', async () => {
      await order({ guestEmail: EMAIL });

      await issue();

      expect(email.sent).toEqual([
        expect.objectContaining({
          to: EMAIL,
          subject: 'Consulta tus pedidos',
          text: expect.stringContaining(
            'http://localhost:5173/order-access?token=',
          ),
        }),
      ]);
      const token = email.lastToken(EMAIL);
      expect(await prisma.orderAccessToken.findMany()).toEqual([
        {
          id: expect.any(String),
          contactEmail: EMAIL,
          tokenHash: sha256(token),
          expiresAt: new Date(START + THIRTY_MINUTES),
          usedAt: null,
          invalidatedAt: null,
          createdAt: expect.any(Date),
        },
      ]);
    });

    it('replaces the pending link of the email with the newer one, never one already used', async () => {
      await order({ guestEmail: EMAIL });
      await issue();
      const used = email.lastToken(EMAIL);
      await redeem(used);
      await issue();
      const first = email.lastToken(EMAIL);
      now += 60_000;

      await issue();

      const second = email.lastToken(EMAIL);
      const linkOf = (token: string) =>
        prisma.orderAccessToken.findUniqueOrThrow({
          where: { tokenHash: sha256(token) },
        });
      expect(await linkOf(used)).toMatchObject({
        usedAt: new Date(START),
        invalidatedAt: null,
      });
      expect(await linkOf(first)).toMatchObject({
        usedAt: null,
        invalidatedAt: new Date(now),
      });
      await expect(redeem(first)).rejects.toThrow(InvalidOrExpiredTokenError);
      await expect(redeem(second)).resolves.toMatchObject({
        contactEmail: EMAIL,
      });
    });

    it("sends nothing to an email without guest orders, or with only a customer's order", async () => {
      await order({ guestEmail: 'otra@example.com' });
      await order({ customerId: newId(), email: EMAIL });

      await issue();
      await issue('nadie@example.com');

      expect(email.sent).toEqual([]);
      expect(await prisma.orderAccessToken.count()).toBe(0);
    });

    it('waits for an anonymization of the email in progress, and then sends nothing', async () => {
      await order({ guestEmail: EMAIL });
      const client = await holder();
      try {
        // An anonymization of the guest takes the lock of the email before it commits.
        await client.query(
          'SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))',
          [ORDER_ACCESS_LOCK, EMAIL],
        );
        await client.query(
          'UPDATE orders SET contact_email = NULL, anonymized_at = now() WHERE contact_email = $1',
          [EMAIL],
        );
        const issuing = issue();
        await waitForLockWaiters(1);
        await client.query('COMMIT');
        await issuing;
      } finally {
        await client.end();
      }

      expect(email.sent).toEqual([]);
      expect(await prisma.orderAccessToken.count()).toBe(0);
    });
  });

  describe('using a link', () => {
    it("answers the guest orders of the email, newest first, never a customer's nor another email's", async () => {
      const older = await order({ guestEmail: EMAIL }, 120);
      const newer = await order({ guestEmail: EMAIL }, 30);
      await order({ guestEmail: 'otra@example.com' });
      await order({ customerId: newId(), email: EMAIL });
      await issue();

      const access = await redeem(email.lastToken(EMAIL));

      expect(access.contactEmail).toBe(EMAIL);
      expect(access.orders).toEqual([
        expect.objectContaining({
          publicCode: newer,
          contactEmail: EMAIL,
          customerId: null,
          itemCount: 1,
          payment: null,
          shipment: null,
        }),
        expect.objectContaining({ publicCode: older }),
      ]);
    });

    it('works once', async () => {
      await order({ guestEmail: EMAIL });
      await issue();
      const token = email.lastToken(EMAIL);

      await redeem(token);

      await expect(redeem(token)).rejects.toThrow(InvalidOrExpiredTokenError);
      expect(
        await prisma.orderAccessToken.findUniqueOrThrow({
          where: { tokenHash: sha256(token) },
        }),
      ).toMatchObject({ usedAt: new Date(START) });
    });

    it('works once also when two use it at once', async () => {
      await order({ guestEmail: EMAIL });
      await issue();
      const token = email.lastToken(EMAIL);
      const client = await holder();
      let results: PromiseSettledResult<unknown>[];
      try {
        await client.query(
          'SELECT id FROM order_access_tokens WHERE token_hash = $1 FOR UPDATE',
          [sha256(token)],
        );
        const both = Promise.allSettled([redeem(token), redeem(token)]);
        await waitForLockWaiters(2);
        await client.query('COMMIT');
        results = await both;
      } finally {
        await client.end();
      }

      expect(results.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
    });

    it('stops working once its 30 minutes pass', async () => {
      await order({ guestEmail: EMAIL });
      await issue();
      now += THIRTY_MINUTES;

      await expect(redeem(email.lastToken(EMAIL))).rejects.toThrow(
        InvalidOrExpiredTokenError,
      );
    });

    it('lists at most the newest orders it is asked for', async () => {
      const newest = await order({ guestEmail: EMAIL }, 10);
      await order({ guestEmail: EMAIL }, 20);

      const orders = await run(() =>
        moduleRef.get(OrderingQueries).listGuestOrders(EMAIL, 1),
      );

      expect(orders.map(({ publicCode }) => publicCode)).toEqual([newest]);
    });
  });

  describe('anonymizing the guest (ADR-0067)', () => {
    it('deletes the links of their email, in any state, and no link is issued for it after', async () => {
      const code = await order({ guestEmail: EMAIL });
      await order({ guestEmail: 'otra@example.com' });
      await issue();
      await redeem(email.lastToken(EMAIL));
      await issue();
      await issue('otra@example.com');
      email.sent.length = 0;

      expect(await anonymizeGuest(code)).toBe(1);
      await issue();

      expect(
        await prisma.orderAccessToken.findMany({
          select: { contactEmail: true },
        }),
      ).toEqual([{ contactEmail: 'otra@example.com' }]);
      expect(email.sent).toEqual([]);
    });

    it('waits for a link being issued, and deletes it', async () => {
      const code = await order({ guestEmail: EMAIL });
      const client = await holder();
      try {
        // Issuing takes the lock of the email before it stores the link.
        await client.query(
          'SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))',
          [ORDER_ACCESS_LOCK, EMAIL],
        );
        await client.query(
          `INSERT INTO order_access_tokens (id, contact_email, token_hash, expires_at)
           VALUES ($1, $2, 'hash', $3)`,
          [newId(), EMAIL, new Date(START + THIRTY_MINUTES)],
        );
        const anonymizing = anonymizeGuest(code);
        await waitForLockWaiters(1);
        await client.query('COMMIT');
        await anonymizing;
      } finally {
        await client.end();
      }

      expect(await prisma.orderAccessToken.count()).toBe(0);
    });
  });

  describe('the daily cleanup (ADR-0144)', () => {
    async function link(changes: object): Promise<string> {
      const id = newId();
      await prisma.orderAccessToken.create({
        data: {
          id,
          contactEmail: EMAIL,
          tokenHash: sha256(id),
          expiresAt: new Date(START + 60_000),
          ...changes,
        },
      });
      return id;
    }

    it('deletes the links expired, used or replaced, in batches, and keeps the ones that still work', async () => {
      const live = await link({});
      await link({ expiresAt: new Date(START) });
      await link({ usedAt: new Date(START - 60_000) });
      await link({ invalidatedAt: new Date(START - 60_000) });
      const spent = moduleRef.get(SpentAccessTokens);

      expect(await run(() => spent.delete(new Date(START), 2))).toBe(2);
      expect(await run(() => spent.delete(new Date(START), 2))).toBe(1);

      expect(
        await prisma.orderAccessToken.findMany({ select: { id: true } }),
      ).toEqual([{ id: live }]);
    });
  });
});
