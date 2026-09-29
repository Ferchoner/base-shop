import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/** A small IP budget, so it runs out in a few requests. */
const TEST_LIMITS = { RATE_LIMIT_PASSWORD_RESET_IP: '3/1h' };

/** Recovery requests are limited per IP too, whatever the email (T-123, ADR-0065, ADR-0102). */
describe('Password recovery limits (e2e, T-123)', () => {
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

  it('stops an IP after its budget, whatever the email', async () => {
    const requestReset = (email: string) =>
      request(app.getHttpServer())
        .post('/v1/auth/password-reset/request')
        .send({ email });

    for (const email of [
      'uno@example.com',
      'dos@example.com',
      'tres@example.com',
    ]) {
      await requestReset(email).expect(202);
    }

    const response = await requestReset('cuatro@example.com').expect(429);

    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });
});
