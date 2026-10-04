import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { RateLimit } from '../src/platform/http/rate-limiting/rate-limit.decorator.js';

/** A small default limit, and a large specific one, so only the default one is reached. */
const TEST_LIMITS = {
  RATE_LIMIT_DEFAULT: '3/1m',
  RATE_LIMIT_PLACE_ORDER: '1000/10m',
};

/** Test-only endpoints: one with the default limit alone, one with a specific limit counted per cart. */
@Controller()
class DefaultLimitTestController {
  @Get('test-default/any')
  any() {
    return { ok: true };
  }

  @Post('test-default/orders')
  @RateLimit('place-order')
  placeOrder(@Body() _body: unknown) {
    return { ok: true };
  }

  @Post('webhooks/test-provider')
  webhook() {
    return { ok: true };
  }
}

/**
 * The default limit counts every request per IP, also on endpoints with a specific limit, whose key the client may
 * change on every request (T-126, T-310, ADR-0102, ADR-0154). The tests share one budget per IP, so they run in order.
 */
describe('Default rate limit (e2e, T-310)', () => {
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
      controllers: [DefaultLimitTestController],
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

  const http = () => request(app.getHttpServer());

  function expectLimited(response: request.Response): void {
    expect(response.status).toBe(429);
    expect(response.body.type).toBe('/problems/rate-limit-exceeded');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  }

  it('limits every endpoint per IP, also one with its own limit and a new cart each time (SA-01)', async () => {
    const place = () =>
      http().post('/v1/test-default/orders').send({ cartId: randomUUID() });

    await http().get('/v1/test-default/any').expect(200);
    await place().expect(201);
    await place().expect(201);

    expectLimited(await place());
    expectLimited(await http().get('/v1/test-default/any'));
  });

  it('never limits payment webhooks (ADR-0071)', async () => {
    // The IP budget ran out in the previous test.
    for (let call = 0; call < 5; call++) {
      await http().post('/v1/webhooks/test-provider').expect(201);
    }
  });
});
