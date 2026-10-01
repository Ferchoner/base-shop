import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import {
  cartScope,
  userScope,
} from '../src/platform/http/idempotency/idempotency-scope.js';
import { ABANDONED_AFTER_MS } from '../src/platform/http/idempotency/idempotency.store.js';
import { Idempotent } from '../src/platform/http/idempotency/idempotent.decorator.js';
import { requestFingerprint } from '../src/platform/http/idempotency/request-fingerprint.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { DomainError } from '../src/shared-kernel/index.js';

class InsufficientStockError extends DomainError {
  readonly code = 'insufficient-stock';
  readonly category = 'conflict';
}

/** A validation error found by the domain, such as a state that does not exist (ADR-0132). */
class UnknownStateError extends DomainError {
  readonly code = 'validation-error';
  readonly category = 'invalid';
}

class PlaceOrderDto {
  @IsUUID()
  cartId: string;

  @IsInt()
  @Min(0)
  expectedTotal: number;

  @IsOptional()
  @IsInt()
  delayMs?: number;

  @IsOptional()
  @IsIn(['domain', 'domain-validation', 'unexpected'])
  fail?: 'domain' | 'domain-validation' | 'unexpected';
}

class CustomerOrderDto {
  @IsInt()
  expectedTotal: number;
}

/** Stands in for authentication (ADR-0114): the user id comes from a test header. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: { id: string } }>();
    request.user = { id: request.headers['x-test-user'] };
    return true;
  }
}

/** Test-only endpoints; `executions` counts how many times an operation really ran. */
@Controller('test-idempotency')
class IdempotencyTestController {
  static executions = 0;

  @Post('orders')
  @Idempotent(cartScope)
  async placeOrder(
    @Body() order: PlaceOrderDto,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ) {
    IdempotencyTestController.executions += 1;
    if (order.delayMs) await sleep(order.delayMs);
    if (order.fail === 'domain') {
      throw new InsufficientStockError('No stock for the cart', {
        lines: [{ variantId: order.cartId, canFulfill: false }],
      });
    }
    if (order.fail === 'domain-validation') {
      throw new UnknownStateError('The state does not exist', {
        errors: [{ field: 'shippingAddress.stateCode', code: 'isState' }],
      });
    }
    if (order.fail === 'unexpected') throw new Error('database unreachable');
    const orderNumber = IdempotencyTestController.executions;
    response.setHeader('Location', `/v1/me/orders/ORDER-${orderNumber}`);
    return { orderNumber, total: order.expectedTotal };
  }

  @Post('orders/:publicCode/payments')
  @Idempotent(cartScope)
  startPayment(
    @Param('publicCode') publicCode: string,
    @Body() body: PlaceOrderDto,
  ) {
    IdempotencyTestController.executions += 1;
    return { publicCode, cartId: body.cartId };
  }

  @Post('me/orders')
  @UseGuards(FakeAuthGuard)
  @Idempotent(userScope)
  placeCustomerOrder(@Body() order: CustomerOrderDto) {
    IdempotencyTestController.executions += 1;
    return { total: order.expectedTotal };
  }
}

describe('Idempotency-Key (e2e, T-115)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [IdempotencyTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    IdempotencyTestController.executions = 0;
    await prisma.idempotencyKey.deleteMany({
      where: { endpoint: { contains: 'test-idempotency' } },
    });
  });

  const http = () => request(app.getHttpServer());
  const order = (overrides: Partial<PlaceOrderDto> = {}) => ({
    cartId: randomUUID(),
    expectedTotal: 129700,
    ...overrides,
  });
  const placeOrder = (key: string | undefined, body: object) => {
    const call = http().post('/v1/test-idempotency/orders');
    return (key === undefined ? call : call.set('Idempotency-Key', key)).send(
      body,
    );
  };

  it('replays the stored response, Location included, without running the operation again', async () => {
    const key = randomUUID();
    const body = order();

    const first = await placeOrder(key, body).expect(201);
    const second = await placeOrder(key, body).expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.headers.location).toBe(first.headers.location);
    expect(IdempotencyTestController.executions).toBe(1);
  });

  it('treats the same fields in another order as the same content', async () => {
    const key = randomUUID();
    const cartId = randomUUID();

    await placeOrder(key, { cartId, expectedTotal: 100 }).expect(201);
    await placeOrder(key, { expectedTotal: 100, cartId }).expect(201);

    expect(IdempotencyTestController.executions).toBe(1);
  });

  it('rejects the same key with other content with 422', async () => {
    const key = randomUUID();
    const body = order();

    await placeOrder(key, body).expect(201);
    const response = await placeOrder(key, {
      ...body,
      expectedTotal: 1,
    }).expect(422);

    expect(response.body.type).toBe('/problems/idempotency-key-mismatch');
    expect(IdempotencyTestController.executions).toBe(1);
  });

  it.each([
    ['missing', undefined],
    ['empty', '  '],
  ])(
    'rejects a %s key with 400 idempotency-key-missing',
    async (_case, key) => {
      const response = await placeOrder(key, order()).expect(400);

      expect(response.body.type).toBe('/problems/idempotency-key-missing');
      expect(IdempotencyTestController.executions).toBe(0);
    },
  );

  it('rejects a key longer than 255 characters with 400 validation-error', async () => {
    const response = await placeOrder('k'.repeat(256), order()).expect(400);

    expect(response.body).toMatchObject({
      type: '/problems/validation-error',
      errors: [{ field: 'Idempotency-Key', code: 'maxLength' }],
    });
  });

  it('runs two simultaneous requests with the same key only once (409 with Retry-After for the other)', async () => {
    const key = randomUUID();
    const body = order({ delayMs: 300 });

    const responses = await Promise.all([
      placeOrder(key, body),
      placeOrder(key, body),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body.type).toBe(
      '/problems/idempotency-request-in-progress',
    );
    expect(conflict?.headers['retry-after']).toBe('2');
    expect(IdempotencyTestController.executions).toBe(1);
  });

  it('replays a business error without running the operation again', async () => {
    const key = randomUUID();
    const body = order({ fail: 'domain' });

    const first = await placeOrder(key, body).expect(409);
    const second = await placeOrder(key, body).expect(409);

    expect(second.body.type).toBe('/problems/insufficient-stock');
    expect(second.body.lines).toEqual(first.body.lines);
    expect(second.body.correlationId).not.toBe(first.body.correlationId);
    expect(IdempotencyTestController.executions).toBe(1);
  });

  it('does not keep a validation error, so the key can be used again', async () => {
    const key = randomUUID();
    const cartId = randomUUID();

    await placeOrder(key, { cartId, expectedTotal: -1 }).expect(400);
    await placeOrder(key, { cartId, expectedTotal: 100 }).expect(201);

    expect(IdempotencyTestController.executions).toBe(1);
  });

  it('does not keep a validation error of the domain either (ADR-0132)', async () => {
    const key = randomUUID();
    const cartId = randomUUID();

    await placeOrder(key, {
      cartId,
      expectedTotal: 100,
      fail: 'domain-validation',
    }).expect(400);
    await placeOrder(key, { cartId, expectedTotal: 100 }).expect(201);

    expect(IdempotencyTestController.executions).toBe(2);
  });

  it('does not keep an unexpected error, so the client can retry with the same key', async () => {
    const key = randomUUID();
    const body = order({ fail: 'unexpected' });

    await placeOrder(key, body).expect(500);
    await placeOrder(key, body).expect(500);

    expect(IdempotencyTestController.executions).toBe(2);
  });

  it('binds the key to its scope: another cart can use the same key', async () => {
    const key = randomUUID();

    await placeOrder(key, order()).expect(201);
    await placeOrder(key, order()).expect(201);

    expect(IdempotencyTestController.executions).toBe(2);
  });

  it('binds the key to the users of customer routes', async () => {
    const key = randomUUID();
    const placeAs = (userId: string) =>
      http()
        .post('/v1/test-idempotency/me/orders')
        .set('Idempotency-Key', key)
        .set('x-test-user', userId)
        .send({ expectedTotal: 100 });
    const ana = randomUUID();

    await placeAs(ana).expect(201);
    await placeAs(ana).expect(201);
    await placeAs(randomUUID()).expect(201);

    expect(IdempotencyTestController.executions).toBe(2);
  });

  it('includes route parameters in the content: the same key for another order is a 422', async () => {
    const key = randomUUID();
    const body = order();
    const pay = (publicCode: string) =>
      http()
        .post(`/v1/test-idempotency/orders/${publicCode}/payments`)
        .set('Idempotency-Key', key)
        .send(body);

    await pay('K7M4Q9XA').expect(201);
    await pay('K7M4Q9XA').expect(201);
    await pay('ZZZZ1111').expect(422);

    expect(IdempotencyTestController.executions).toBe(1);
  });

  describe('keys left behind', () => {
    const endpoint = 'POST /v1/test-idempotency/orders';

    async function storeKey(
      key: string,
      body: PlaceOrderDto,
      fields: {
        status: 'IN_PROGRESS' | 'COMPLETED';
        createdAt: Date;
        expiresAt: Date;
      },
    ) {
      await prisma.idempotencyKey.create({
        data: {
          scopeType: 'CART',
          scopeId: body.cartId,
          endpoint,
          key,
          requestHash: requestFingerprint({}, body),
          status: fields.status,
          responseStatus: 201,
          responseBody: { kind: 'success', status: 201, body: { stale: true } },
          createdAt: fields.createdAt,
          expiresAt: fields.expiresAt,
        },
      });
    }

    it('runs again after the 24-hour retention', async () => {
      const key = randomUUID();
      const body = order();
      const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await storeKey(key, body, {
        status: 'COMPLETED',
        createdAt: dayAgo,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const response = await placeOrder(key, body).expect(201);

      expect(response.body).not.toHaveProperty('stale');
      expect(IdempotencyTestController.executions).toBe(1);
    });

    it('takes over a request abandoned in progress with the same content', async () => {
      const key = randomUUID();
      const body = order();
      await storeKey(key, body, {
        status: 'IN_PROGRESS',
        createdAt: new Date(Date.now() - ABANDONED_AFTER_MS - 1_000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await placeOrder(key, body).expect(201);

      expect(IdempotencyTestController.executions).toBe(1);
    });

    it('still answers 409 while the original request is recent', async () => {
      const key = randomUUID();
      const body = order();
      await storeKey(key, body, {
        status: 'IN_PROGRESS',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await placeOrder(key, body).expect(409);

      expect(IdempotencyTestController.executions).toBe(0);
    });

    it('never takes over an abandoned request with other content', async () => {
      const key = randomUUID();
      const body = order();
      await storeKey(key, body, {
        status: 'IN_PROGRESS',
        createdAt: new Date(Date.now() - ABANDONED_AFTER_MS - 1_000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await placeOrder(key, { ...body, expectedTotal: 1 }).expect(422);

      expect(IdempotencyTestController.executions).toBe(0);
    });
  });
});
