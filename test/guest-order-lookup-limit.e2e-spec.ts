import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/** The real limit of the guest's lookup: 2 per IP here instead of 10, to reach it quickly (ADR-0065). */
describe('Guest order lookup: limit per IP (e2e, T-185)', () => {
  let app: INestApplication<App>;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.RATE_LIMIT_GUEST_ORDER;
    process.env.RATE_LIMIT_GUEST_ORDER = '2/15m';
    // AppModule validates the environment when it loads, so import it after setting the variable.
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
    if (previous === undefined) delete process.env.RATE_LIMIT_GUEST_ORDER;
    else process.env.RATE_LIMIT_GUEST_ORDER = previous;
  });

  it('answers 429 with Retry-After once an IP used its lookups, found or not', async () => {
    const lookup = () =>
      request(app.getHttpServer())
        .post('/v1/orders/lookup')
        .send({ contactEmail: 'cliente@example.com', publicCode: 'ZZZZ-ZZZZ' });

    await lookup().expect(404);
    await lookup().expect(404);
    const limited = await lookup().expect(429);

    expect(limited.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
