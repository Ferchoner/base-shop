import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** With `MANUAL_PAYMENTS_ENABLED=false`, as in any environment that does not turn it on (ADR-0040). */
describe('Manual payments turned off (e2e, T-190)', () => {
  let app: INestApplication<App>;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.MANUAL_PAYMENTS_ENABLED;
    process.env.MANUAL_PAYMENTS_ENABLED = 'false';
    // AppModule validates the environment when it loads, so import it after setting the variable.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.MANUAL_PAYMENTS_ENABLED;
    else process.env.MANUAL_PAYMENTS_ENABLED = previous;
  });

  const http = () => request(app.getHttpServer());

  it('answers 403 manual-payments-disabled to the staff, before looking at the order', async () => {
    const response = await http()
      .post(`/v1/admin/orders/${newId()}/manual-capture`)
      .set(
        signedInAs({
          id: newId(),
          type: 'STAFF',
          permissions: ['orders.read', 'payments.manage'],
          mustChangePassword: false,
          sessionId: newId(),
        }),
      )
      .send({ reference: 'Ticket 00452' })
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
