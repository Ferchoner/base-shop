import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS,
  InactiveCustomerAnonymizations,
} from '../src/modules/privacy/application/inactive-customer-anonymizations.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { monthsBefore, newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The anonymization of inactive customers, with a period of 24 months, in the whole application (T-232, ADR-0152). */
describe('Inactive customers (e2e, T-232)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS)
      .useValue(24)
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'customers.anonymize' },
    });
    await prisma.cartLine.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const reader: AuthenticatedUser = {
    id: newId(),
    type: 'STAFF',
    permissions: ['customers.read'],
    mustChangePassword: false,
    sessionId: newId(),
  };

  /** A verified customer, last active `months` months ago, with a session and a cart. */
  async function customer(months: number): Promise<string> {
    const id = newId();
    const lastActiveAt = monthsBefore(new Date(), months);
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash: 'not-a-real-hash',
        emailVerifiedAt: lastActiveAt,
        privacyNoticeVersion: '2026-09',
        lastLoginAt: lastActiveAt,
        lastActiveAt,
      },
    });
    await prisma.refreshToken.create({
      data: {
        id: newId(),
        userId: id,
        sessionId: newId(),
        tokenHash: `refresh-${id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
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
    return id;
  }

  const adminCustomer = async (userId: string) =>
    (
      await request(app.getHttpServer())
        .get(`/v1/admin/identity/customers/${userId}`)
        .set(signedInAs(reader))
        .expect(200)
    ).body;

  it('anonymizes the account of a customer without activity for the period, which the staff still reads, and keeps the active one', async () => {
    const idle = await customer(25);
    const active = await customer(1);

    expect(
      await app
        .get(ClsService)
        .run(() => app.get(InactiveCustomerAnonymizations).run()),
    ).toEqual({ anonymized: 1, skipped: 0, failed: 0 });

    expect(await adminCustomer(idle)).toMatchObject({
      email: null,
      firstNames: null,
      lastNames: null,
      status: 'ANONYMIZED',
      anonymizedAt: expect.any(String),
      addresses: [],
      version: 2,
    });
    expect(await adminCustomer(active)).toMatchObject({
      email: `${active}@example.com`,
      status: 'ACTIVE',
    });
    expect(await prisma.refreshToken.count({ where: { userId: idle } })).toBe(
      0,
    );
    expect(await prisma.cart.count({ where: { ownerUserId: idle } })).toBe(0);
    expect(await prisma.cart.count({ where: { ownerUserId: active } })).toBe(1);
  });
});
