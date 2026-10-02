import { Test, type TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { TokenCleanup } from '../../src/modules/identity-access/application/token-cleanup.js';
import { TokenCleanupJob } from '../../src/modules/identity-access/infrastructure/token-cleanup.job.js';
import { WebhookEventCleanup } from '../../src/modules/payments/application/webhook-event-cleanup.js';
import { WebhookEventCleanupJob } from '../../src/modules/payments/infrastructure/webhook-event-cleanup.job.js';
import { GuestCartCleanupJob } from '../../src/modules/shopping/infrastructure/guest-cart-cleanup.job.js';
import {
  GuestCartCleanup,
  InactiveGuestCarts,
} from '../../src/modules/shopping/application/guest-cart-cleanup.js';
import { IdempotencyCleanupJob } from '../../src/platform/http/idempotency/idempotency-cleanup.job.js';
import { PrismaService } from '../../src/platform/persistence/prisma.service.js';
import { newCredentialId, newId } from '../../src/shared-kernel/index.js';
import { waitForLockWaiters } from '../support/lock-waiters.js';

const DAY = 86_400_000;

/** `days` ago; a negative number is in the future. */
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** The daily cleanup against PostgreSQL 18 (T-231, UC-SYS-01, UC-CRT-07, ADR-0029, ADR-0144). */
describe('Daily cleanup (T-231)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.processedWebhookEvent.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.user.deleteMany();
  });

  const run = <T>(work: () => Promise<T>) => cls.run(work);

  it('has a job for each owner of the tables', () => {
    for (const job of [
      TokenCleanupJob,
      GuestCartCleanupJob,
      WebhookEventCleanupJob,
      IdempotencyCleanupJob,
    ]) {
      expect(moduleRef.get(job, { strict: false })).toBeInstanceOf(job);
    }
  });

  async function customer(): Promise<string> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: new Date(),
      },
    });
    return id;
  }

  async function cart(
    lastActivity: Date,
    changes: {
      ownerUserId?: string;
      status?: 'ACTIVE' | 'CHECKED_OUT' | 'MERGED';
      mergedIntoCartId?: string;
    } = {},
  ): Promise<string> {
    const id = newCredentialId();
    await prisma.cart.create({
      data: {
        id,
        ownerUserId: changes.ownerUserId ?? null,
        status: changes.status ?? 'ACTIVE',
        mergedIntoCartId: changes.mergedIntoCartId ?? null,
        lastActivityAt: lastActivity,
        lines: { create: { variantId: newId(), quantity: 1 } },
      },
    });
    return id;
  }

  const remainingCarts = async () =>
    (await prisma.cart.findMany({ select: { id: true } })).map(({ id }) => id);

  it('deletes refresh tokens 30 days after they expired or were revoked, and the links that no longer work', async () => {
    const userId = await customer();
    const token = (name: string) => ({
      id: newId(),
      userId,
      tokenHash: `${name}-${newId()}`,
    });
    const refresh = (
      name: string,
      changes: { expiresAt?: Date; revokedAt?: Date },
    ) => ({
      ...token(name),
      sessionId: newId(),
      expiresAt: ago(-7),
      ...changes,
    });
    await prisma.refreshToken.createMany({
      data: [
        refresh('expired-long-ago', { expiresAt: ago(31) }),
        refresh('revoked-long-ago', { revokedAt: ago(31) }),
        refresh('revoked-recently', { revokedAt: ago(29) }),
        refresh('expired-recently', { expiresAt: ago(29) }),
        refresh('active', {}),
      ],
    });
    const link = (
      name: string,
      changes: { expiresAt?: Date; usedAt?: Date; invalidatedAt?: Date },
    ) => ({ ...token(name), expiresAt: ago(-1), ...changes });
    const links = [
      link('expired', { expiresAt: ago(0.01) }),
      link('used', { usedAt: ago(0.5) }),
      link('replaced', { invalidatedAt: ago(0.5) }),
      link('usable', {}),
    ];
    await prisma.emailVerificationToken.createMany({
      data: links.map((data) => ({ ...data, email: 'ana@example.com' })),
    });
    await prisma.passwordResetToken.createMany({ data: links });

    const report = await run(() => moduleRef.get(TokenCleanup).run());

    expect(report).toEqual({
      refreshTokens: 2,
      emailVerificationTokens: 3,
      passwordResetTokens: 3,
    });
    const hashes = async (rows: Promise<{ tokenHash: string }[]>) =>
      (await rows).map(({ tokenHash }) => tokenHash.split('-')[0]).sort();
    expect(await hashes(prisma.refreshToken.findMany())).toEqual([
      'active',
      'expired',
      'revoked',
    ]);
    expect(await hashes(prisma.emailVerificationToken.findMany())).toEqual([
      'usable',
    ]);
    expect(await hashes(prisma.passwordResetToken.findMany())).toEqual([
      'usable',
    ]);
    expect(
      (
        await prisma.refreshToken.findMany({
          select: { revokedAt: true, expiresAt: true },
        })
      ).every(
        ({ revokedAt, expiresAt }) =>
          (revokedAt === null || revokedAt > ago(30)) && expiresAt > ago(30),
      ),
    ).toBe(true);
  });

  it("deletes guest carts 30 days after their last activity, in any status and with their lines, never a customer's", async () => {
    const owner = await customer();
    const customerCart = await cart(ago(90), { ownerUserId: owner });
    await cart(ago(31));
    await cart(ago(31), { status: 'CHECKED_OUT' });
    await cart(ago(45), { status: 'MERGED', mergedIntoCartId: customerCart });
    const recent = await cart(ago(29));

    expect(await run(() => moduleRef.get(GuestCartCleanup).run())).toBe(3);

    expect((await remainingCarts()).sort()).toEqual(
      [customerCart, recent].sort(),
    );
    expect(await prisma.cartLine.count()).toBe(2);
  });

  it('fills each batch with guest carts only, the oldest first, up to its limit', async () => {
    // Older customer carts never take the place of a guest cart in a batch.
    const owner = await customer();
    const kept = [
      await cart(ago(90), { ownerUserId: owner }),
      await cart(ago(80), { ownerUserId: await customer() }),
    ];
    // Created youngest first: the oldest go first all the same.
    const youngest = await cart(ago(31));
    await cart(ago(32));
    await cart(ago(33));
    const carts = moduleRef.get(InactiveGuestCarts);

    expect(await carts.delete(ago(30), 2)).toBe(2);
    expect((await remainingCarts()).sort()).toEqual([...kept, youngest].sort());
    expect(await carts.delete(ago(30), 2)).toBe(1);
    expect((await remainingCarts()).sort()).toEqual([...kept].sort());
  });

  it('keeps a guest cart used while the cleanup runs, which waits for it', async () => {
    const used = await cart(ago(40));
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    let deleted: number;
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE carts SET last_activity_at = now() WHERE id = $1',
        [used],
      );
      const cleanup = run(() => moduleRef.get(GuestCartCleanup).run());
      await waitForLockWaiters(1);
      await client.query('COMMIT');
      deleted = await cleanup;
    } finally {
      await client.end();
    }

    expect(deleted).toBe(0);
    expect(await remainingCarts()).toEqual([used]);
  });

  it('deletes webhook events 30 days after they were processed, and the idempotency keys that expired', async () => {
    await prisma.processedWebhookEvent.createMany({
      data: [
        { provider: 'PAYPAL', eventId: 'WH-OLD', processedAt: ago(31) },
        { provider: 'PAYPAL', eventId: 'WH-RECENT', processedAt: ago(29) },
      ],
    });
    const key = (name: string, expiresAt: Date) => ({
      scopeType: 'USER' as const,
      scopeId: newId(),
      endpoint: 'POST /v1/me/orders',
      key: name,
      requestHash: 'hash',
      status: 'COMPLETED' as const,
      createdAt: new Date(expiresAt.getTime() - DAY),
      expiresAt,
    });
    await prisma.idempotencyKey.createMany({
      data: [key('expired', ago(0.01)), key('live', ago(-0.5))],
    });

    expect(await run(() => moduleRef.get(WebhookEventCleanup).run())).toBe(1);
    expect(
      await run(() => moduleRef.get(IdempotencyCleanupJob).cleanUp()),
    ).toBe(1);

    expect(
      (await prisma.processedWebhookEvent.findMany()).map(
        ({ eventId }) => eventId,
      ),
    ).toEqual(['WH-RECENT']);
    expect(
      (await prisma.idempotencyKey.findMany()).map(({ key: name }) => name),
    ).toEqual(['live']);
  });
});
