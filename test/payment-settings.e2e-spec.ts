import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  newId,
  PERMISSION_CODES,
  type PermissionCode,
} from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** The only row of the settings, which its migration creates. */
const SETTINGS_ID = '01a11302-41ef-7d33-9e36-93a5239b19ba';

/** Manual payments enabled from the API over HTTP (T-194, UC-PAY-08, ADR-0162). */
describe('Payment settings (e2e, T-194)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const staff = (...permissions: PermissionCode[]): AuthenticatedUser => ({
    id: newId(),
    type: 'STAFF',
    permissions,
    mustChangePassword: false,
    sessionId: newId(),
  });
  const superadmin = staff(...PERMISSION_CODES);
  // Every permission but the two that the Administrador role lacks (ADR-0043, ADR-0162).
  const administrator = staff(
    ...PERMISSION_CODES.filter(
      (code) => code !== 'staff.manage' && code !== 'payments.configure',
    ),
  );
  const seller = staff(
    'catalog.read',
    'inventory.read',
    'orders.read',
    'orders.place',
    'customers.read',
  );
  const cashier = staff('orders.read', 'payments.manage');

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    // On again, as every e2e file starts (e2e-manual-payments.ts).
    await prisma.paymentSettings.update({
      where: { id: SETTINGS_ID },
      data: { manualPaymentsEnabled: true },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const read = async () =>
    (
      await http()
        .get('/v1/admin/payment-settings')
        .set(signedInAs(superadmin))
        .expect(200)
    ).body as { manualPaymentsEnabled: boolean; version: number };
  const change = (
    by: AuthenticatedUser,
    body: Record<string, unknown>,
    status: number,
  ) =>
    http()
      .put('/v1/admin/payment-settings')
      .set(signedInAs(by))
      .send(body)
      .expect(status);
  const audited = () =>
    prisma.auditLog.findMany({
      where: { action: 'payment-settings.update', actorId: superadmin.id },
      orderBy: { occurredAt: 'asc' },
      select: { resourceType: true, resourceId: true, changes: true },
    });

  it('tells the staff who reads orders whether manual payments are on, the seller included', async () => {
    const response = await http()
      .get('/v1/admin/payment-settings')
      .set(signedInAs(seller))
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      manualPaymentsEnabled: true,
      version: expect.any(Number),
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('lets only a superadmin turn them off and on, and the payments in the store follow at once', async () => {
    const { version } = await read();

    await change(administrator, { manualPaymentsEnabled: false, version }, 403);
    const off = await change(
      superadmin,
      { manualPaymentsEnabled: false, version },
      200,
    );

    expect(off.body).toEqual({
      manualPaymentsEnabled: false,
      version: version + 1,
      updatedAt: expect.any(String),
    });
    const capture = () =>
      http()
        .post(`/v1/admin/orders/${newId()}/manual-capture`)
        .set(signedInAs(cashier))
        .send({ reference: 'Ticket 00452' });
    expect((await capture().expect(403)).body.type).toBe(
      '/problems/manual-payments-disabled',
    );
    expect(
      (
        await http()
          .post(`/v1/admin/payments/${newId()}/refunds/manual`)
          .set(signedInAs(cashier))
          .send({ reference: 'Devolución 00087', version: 1 })
          .expect(403)
      ).body.type,
    ).toBe('/problems/manual-payments-disabled');
    expect(
      (
        await http()
          .post('/v1/orders/ZZZZ-ZZZZ/payments')
          .set('Idempotency-Key', randomUUID())
          .send({ cartId: randomUUID(), provider: 'MANUAL' })
          .expect(400)
      ).body.errors,
    ).toEqual([
      expect.objectContaining({ field: 'provider', code: 'isEnabledProvider' }),
    ]);

    await change(
      superadmin,
      { manualPaymentsEnabled: true, version: version + 1 },
      200,
    );

    // On again, the capture gets past the check and looks for the order.
    expect((await capture().expect(404)).body.type).toBe('/problems/not-found');
    expect(await audited()).toEqual([
      {
        resourceType: 'payment-settings',
        resourceId: SETTINGS_ID,
        changes: { manualPaymentsEnabled: { from: true, to: false } },
      },
      {
        resourceType: 'payment-settings',
        resourceId: SETTINGS_ID,
        changes: { manualPaymentsEnabled: { from: false, to: true } },
      },
    ]);
  });

  it('answers 409 to an older version, and saves nothing without a change', async () => {
    const { version } = await read();
    const before = await audited();

    const same = await change(
      superadmin,
      { manualPaymentsEnabled: true, version },
      200,
    );
    const stale = await change(
      superadmin,
      { manualPaymentsEnabled: false, version: version - 1 },
      409,
    );

    expect(same.body).toMatchObject({ manualPaymentsEnabled: true, version });
    expect(stale.body).toMatchObject({
      type: '/problems/version-conflict',
      currentVersion: version,
    });
    expect(await read()).toMatchObject({
      manualPaymentsEnabled: true,
      version,
    });
    expect(await audited()).toEqual(before);
  });

  it('asks for both fields, with a boolean and a version from 1', async () => {
    const { version } = await read();

    const missing = await change(
      superadmin,
      { manualPaymentsEnabled: false },
      400,
    );
    const invalid = await change(
      superadmin,
      { manualPaymentsEnabled: 'false', version: 0 },
      400,
    );

    expect(missing.body.errors).toEqual([
      expect.objectContaining({ field: 'version' }),
    ]);
    expect(
      invalid.body.errors.map(({ field }: { field: string }) => field).sort(),
    ).toEqual(['manualPaymentsEnabled', 'version']);
    expect(await read()).toMatchObject({
      manualPaymentsEnabled: true,
      version,
    });
  });
});
