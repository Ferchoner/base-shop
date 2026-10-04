import { randomUUID } from 'node:crypto';
import { Body, Controller, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { RateLimit } from '../src/platform/http/rate-limiting/rate-limit.decorator.js';

/**
 * Small limits, so each one is reached in a few requests. The default one counts every request too (ADR-0154), so it
 * is large here and tested apart, in default-rate-limit.e2e-spec.ts.
 */
const TEST_LIMITS = {
  RATE_LIMIT_DEFAULT: '1000/1m',
  RATE_LIMIT_REGISTER: '2/1h',
  RATE_LIMIT_PASSWORD_RESET_EMAIL: '2/1h',
  RATE_LIMIT_PASSWORD_RESET_IP: '3/1h',
  RATE_LIMIT_EMAIL_VERIFICATION: '2/1h',
  RATE_LIMIT_GUEST_ORDER: '2/15m',
  RATE_LIMIT_PLACE_ORDER: '2/10m',
};

/** Test-only endpoints standing in for the real ones, each with the limit of API_SPEC.md §7. */
@Controller()
class RateLimitTestController {
  @Post('test-rate/register')
  @RateLimit('register')
  register() {
    return { ok: true };
  }

  @Post('test-rate/password-reset')
  @RateLimit('password-reset-email', 'password-reset-ip')
  passwordReset(@Body() _body: unknown) {
    return { ok: true };
  }

  @Post('test-rate/email-verification/resend')
  @RateLimit('email-verification')
  resendVerification(@Body() _body: unknown) {
    return { ok: true };
  }

  @Post('test-rate/me/email')
  @RateLimit('email-verification')
  changeEmail(@Body() _body: unknown) {
    return { ok: true };
  }

  @Post('test-rate/orders/lookup')
  @RateLimit('guest-order')
  lookup() {
    return { ok: true };
  }

  @Post('test-rate/orders/reorder')
  @RateLimit('guest-order')
  reorder() {
    return { ok: true };
  }

  @Post('test-rate/orders')
  @RateLimit('place-order')
  placeOrder(@Body() _body: unknown) {
    return { ok: true };
  }
}

describe('Rate limiting (e2e, T-126)', () => {
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
      controllers: [RateLimitTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Stands in for authentication, which runs before the rate limit guard (ADR-0114).
    app.use(
      (
        req: { headers: Record<string, string>; user?: { id: string } },
        _res: unknown,
        next: () => void,
      ) => {
        const userId = req.headers['x-test-user'];
        if (userId) req.user = { id: userId };
        next();
      },
    );
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
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  }

  it('limits sign-ups per IP', async () => {
    await http().post('/v1/test-rate/register').expect(201);
    await http().post('/v1/test-rate/register').expect(201);

    expectLimited(await http().post('/v1/test-rate/register'));
  });

  it('limits password reset requests per email and per IP', async () => {
    const reset = (email: string) =>
      http().post('/v1/test-rate/password-reset').send({ email });

    await reset('ana@example.com').expect(201);
    await reset('ana@example.com').expect(201);
    expectLimited(await reset('ANA@example.com'));

    // Another email still has its own budget, until the IP budget (3) runs out.
    await reset('luis@example.com').expect(201);
    expectLimited(await reset('maria@example.com'));
  });

  it('limits verification emails per email, and per user when signed in', async () => {
    const resend = (email: string) =>
      http().post('/v1/test-rate/email-verification/resend').send({ email });
    const change = (userId: string) =>
      http()
        .post('/v1/test-rate/me/email')
        .set('x-test-user', userId)
        .send({ newEmail: `${randomUUID()}@example.com` });

    await resend('pedro@example.com').expect(201);
    await resend('pedro@example.com').expect(201);
    expectLimited(await resend('pedro@example.com'));

    const userId = randomUUID();
    await change(userId).expect(201);
    await change(userId).expect(201);
    expectLimited(await change(userId));
    await change(randomUUID()).expect(201);
  });

  it('shares the guest order budget between lookup and reorder', async () => {
    await http().post('/v1/test-rate/orders/lookup').expect(201);
    await http().post('/v1/test-rate/orders/reorder').expect(201);

    expectLimited(await http().post('/v1/test-rate/orders/lookup'));
  });

  it('limits placed orders per cart, and per user when signed in', async () => {
    const cartId = randomUUID();
    const placeWithCart = (id: string) =>
      http().post('/v1/test-rate/orders').send({ cartId: id });

    await placeWithCart(cartId).expect(201);
    await placeWithCart(cartId).expect(201);
    expectLimited(await placeWithCart(cartId));
    await placeWithCart(randomUUID()).expect(201);

    const userId = randomUUID();
    const placeAsUser = () =>
      http().post('/v1/test-rate/orders').set('x-test-user', userId).send({});
    await placeAsUser().expect(201);
    await placeAsUser().expect(201);
    expectLimited(await placeAsUser());
  });
});
