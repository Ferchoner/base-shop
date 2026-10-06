import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { newId, PERMISSION_CODES } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** With manual payments off, as the migration leaves them until a superadmin turns them on (ADR-0040, ADR-0162). */
describe('Manual payments turned off (e2e, T-190, T-194)', () => {
  let app: INestApplication<App>;

  const http = () => request(app.getHttpServer());
  const superadmin = signedInAs({
    id: newId(),
    type: 'STAFF',
    permissions: [...PERMISSION_CODES],
    mustChangePassword: false,
    sessionId: newId(),
  });
  const cashier = signedInAs({
    id: newId(),
    type: 'STAFF',
    permissions: ['orders.read', 'payments.manage'],
    mustChangePassword: false,
    sessionId: newId(),
  });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    const { body: settings } = await http()
      .get('/v1/admin/payment-settings')
      .set(superadmin)
      .expect(200);
    await http()
      .put('/v1/admin/payment-settings')
      .set(superadmin)
      .send({ manualPaymentsEnabled: false, version: settings.version })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 403 manual-payments-disabled to the staff, before looking at the order', async () => {
    const response = await http()
      .post(`/v1/admin/orders/${newId()}/manual-capture`)
      .set(cashier)
      .send({ reference: 'Ticket 00452' })
      .expect(403);

    expect(response.body).toMatchObject({
      type: '/problems/manual-payments-disabled',
      detail:
        'Los pagos y reembolsos manuales no están habilitados. Un superadministrador los habilita con `PUT /v1/admin/payment-settings`.',
    });
  });

  it('answers 403 manual-payments-disabled to a refund registered by hand, before looking at the payment (ADR-0135)', async () => {
    const response = await http()
      .post(`/v1/admin/payments/${newId()}/refunds/manual`)
      .set(cashier)
      .send({ reference: 'Devolución 00087', version: 1 })
      .expect(403);

    expect(response.body.type).toBe('/problems/manual-payments-disabled');
  });

  it('answers the manual method as a provider that is not enabled', async () => {
    const response = await http()
      .post('/v1/orders/ZZZZ-ZZZZ/payments')
      .set('Idempotency-Key', randomUUID())
      .send({ cartId: randomUUID(), provider: 'MANUAL' })
      .expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field: 'provider', code: 'isEnabledProvider' }),
    ]);
  });
});
