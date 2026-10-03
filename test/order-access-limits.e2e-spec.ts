import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/** A small IP budget, so it runs out in a few requests; the use of a link shares the one of the lookup. */
const TEST_LIMITS = {
  RATE_LIMIT_ORDER_ACCESS_IP: '3/1h',
  RATE_LIMIT_GUEST_ORDER: '2/15m',
};

/** The requests of an access link are limited per IP too, whatever the email (T-186, ADR-0065, ADR-0148). */
describe('Access link to the guest orders: limits (e2e, T-186)', () => {
  let app: INestApplication<App>;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(TEST_LIMITS)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the limits.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const http = () => request(app.getHttpServer());

  it('stops an IP after its budget of requests, whatever the email', async () => {
    for (const contactEmail of [
      'uno@example.com',
      'dos@example.com',
      'tres@example.com',
    ]) {
      await http()
        .post('/v1/orders/access-links')
        .send({ contactEmail })
        .expect(202);
    }

    const response = await http()
      .post('/v1/orders/access-links')
      .send({ contactEmail: 'cuatro@example.com' })
      .expect(429);

    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('spends the budget of the guest lookup when a link is used, found or not', async () => {
    await http()
      .post('/v1/orders/access')
      .send({ token: 'no-existe' })
      .expect(400);
    await http()
      .post('/v1/orders/lookup')
      .send({ contactEmail: 'cliente@example.com', publicCode: 'ZZZZ-ZZZZ' })
      .expect(404);

    const response = await http()
      .post('/v1/orders/access')
      .send({ token: 'no-existe' })
      .expect(429);

    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
  });
});
