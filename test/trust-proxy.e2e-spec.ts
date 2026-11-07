import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/** A small default limit, so the budget of each client IP runs out in a few requests. */
const TEST_ENVIRONMENT = {
  RATE_LIMIT_DEFAULT: '2/1m',
  TRUST_PROXY_HOPS: '1',
};

@Controller()
class TrustProxyTestController {
  @Get('test-proxy/any')
  any() {
    return { ok: true };
  }
}

/**
 * Behind the Caddy of the local network server, every request reaches the API from the proxy; with
 * `TRUST_PROXY_HOPS=1` the client IP of the limits comes from `X-Forwarded-For`, so each device of the store keeps its
 * own budget (ADR-0171).
 */
describe('Trust proxy (e2e, ADR-0171)', () => {
  let app: INestApplication<App>;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting it.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TrustProxyTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
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

  const from = (ip: string) =>
    request(app.getHttpServer())
      .get('/v1/test-proxy/any')
      .set('X-Forwarded-For', ip);

  it('counts the limit per forwarded client IP', async () => {
    await from('192.168.1.21').expect(200);
    await from('192.168.1.21').expect(200);
    await from('192.168.1.21').expect(429);

    await from('192.168.1.22').expect(200);
  });
});
