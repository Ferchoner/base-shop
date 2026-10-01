import { jest } from '@jest/globals';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  type INestApplication,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { ProblemException } from '../src/platform/http/problem-details/problem.exception.js';
import { DomainError } from '../src/shared-kernel/index.js';

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class InsufficientStockError extends DomainError {
  readonly code = 'insufficient-stock';
  readonly category = 'conflict';
}

class StaffCannotPurchaseError extends DomainError {
  readonly code = 'staff-cannot-purchase';
  readonly category = 'forbidden';
}

class UncataloguedError extends DomainError {
  readonly code = 'brand-new-rule';
  readonly category = 'conflict';
}

/** Content rules of files (ADR-0121), with codes missing from the catalog, so their category decides. */
class OversizedSampleError extends DomainError {
  readonly code = 'oversized-sample';
  readonly category = 'too-large';
}

class OddFormatError extends DomainError {
  readonly code = 'odd-format';
  readonly category = 'unsupported';
}

class LineDto {
  @IsInt()
  @Min(1)
  quantity: number;
}

class PlaceOrderDto {
  @IsUUID()
  variantId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @Matches(/^\d{5}$/, { context: { message: 'Debe tener 5 dígitos.' } })
  postalCode: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines?: LineDto[];
}

class SearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}

const VALID_ORDER = {
  variantId: '01a0e4c7-977b-73a2-bcde-dba943668375',
  quantity: 1,
  postalCode: '58000',
};

/** Exists only in this test: each route produces one kind of error. */
@Controller('test-problems')
class ProblemsTestController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Post('orders')
  placeOrder(@Body() order: PlaceOrderDto) {
    return order;
  }

  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return query;
  }

  @Get('insufficient-stock')
  insufficientStock() {
    throw new InsufficientStockError('Variant 42 has 0 units left', {
      lines: [{ variantId: VALID_ORDER.variantId, canFulfill: false }],
    });
  }

  @Get('reserved-extension')
  reservedExtension() {
    throw new InsufficientStockError('Tries to replace standard members', {
      status: 200,
      type: '/problems/fake',
      correlationId: 'fake',
    });
  }

  @Get('staff-purchase')
  staffPurchase() {
    throw new StaffCannotPurchaseError('Staff user tried to buy');
  }

  @Get('uncatalogued')
  uncatalogued() {
    throw new UncataloguedError('A new rule without catalog entry');
  }

  @Get('too-large')
  tooLarge() {
    throw new OversizedSampleError('The sample is too large');
  }

  @Get('unsupported')
  unsupported() {
    throw new OddFormatError('The sample has an odd format');
  }

  @Get('rate-limited')
  rateLimited() {
    throw new ProblemException(
      'rate-limit-exceeded',
      {},
      { 'Retry-After': '30' },
    );
  }

  @Get('framework-forbidden')
  frameworkForbidden() {
    throw new ForbiddenException();
  }

  @Get('teapot')
  teapot() {
    throw new HttpException('I am a teapot', 418);
  }

  @Get('unexpected')
  unexpected() {
    throw new Error('Connection to db failed with password hunter2');
  }
}

describe('Problem Details (e2e, T-113)', () => {
  let app: INestApplication<App>;
  const loggedErrors: unknown[][] = [];

  beforeAll(async () => {
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        loggedErrors.push(args);
      });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProblemsTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const http = () => request(app.getHttpServer());

  describe('format (RFC 9457, ADR-0035, ADR-0064)', () => {
    it('answers an unknown route with a not-found problem', async () => {
      const response = await http()
        .get('/v1/unknown?email=someone@example.com')
        .expect(404);

      expect(response.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      expect(response.body).toEqual({
        type: '/problems/not-found',
        title: 'No encontrado',
        status: 404,
        detail: 'El recurso solicitado no existe.',
        instance: '/v1/unknown',
        correlationId: expect.stringMatching(UUID_V7),
      });
    });

    it('uses the same correlation id in the header and in the body', async () => {
      const response = await http().get('/v1/unknown').expect(404);

      expect(response.headers['x-correlation-id']).toBe(
        response.body.correlationId,
      );
    });
  });

  describe('correlation id (ADR-0071, ADR-0095)', () => {
    it('is sent on successful responses too', async () => {
      const response = await http().get('/v1/test-problems/ok').expect(200);

      expect(response.headers['x-correlation-id']).toMatch(UUID_V7);
    });

    it('is new for each request and ignores one sent by the client', async () => {
      const first = await http()
        .get('/v1/test-problems/ok')
        .set('X-Correlation-Id', 'forged-id');
      const second = await http().get('/v1/test-problems/ok');

      expect(first.headers['x-correlation-id']).toMatch(UUID_V7);
      expect(first.headers['x-correlation-id']).not.toBe(
        second.headers['x-correlation-id'],
      );
    });
  });

  describe('domain errors (ADR-0094)', () => {
    it('maps the category to the status and the details to extensions', async () => {
      const response = await http()
        .get('/v1/test-problems/insufficient-stock')
        .expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/insufficient-stock',
        title: 'Stock insuficiente',
        status: 409,
        detail:
          'Algunos productos no tienen existencias suficientes para la cantidad solicitada.',
        lines: [{ variantId: VALID_ORDER.variantId, canFulfill: false }],
      });
    });

    it('never exposes the domain message, which is meant for the log', async () => {
      const response = await http()
        .get('/v1/test-problems/insufficient-stock')
        .expect(409);

      expect(JSON.stringify(response.body)).not.toContain('Variant 42');
    });

    it('does not let an extension replace a standard member', async () => {
      const response = await http()
        .get('/v1/test-problems/reserved-extension')
        .expect(409);

      expect(response.body.status).toBe(409);
      expect(response.body.type).toBe('/problems/insufficient-stock');
      expect(response.body.correlationId).toMatch(UUID_V7);
    });

    it('answers a forbidden rule with 403', async () => {
      const response = await http()
        .get('/v1/test-problems/staff-purchase')
        .expect(403);

      expect(response.body.type).toBe('/problems/staff-cannot-purchase');
    });

    it('still answers a code missing from the catalog, with the texts of its category', async () => {
      const response = await http()
        .get('/v1/test-problems/uncatalogued')
        .expect(409);

      expect(response.body).toMatchObject({
        type: '/problems/brand-new-rule',
        title: 'Acción no permitida en el estado actual',
      });
    });

    it('answers content rules with 413 and 415, with the texts of their category (ADR-0121)', async () => {
      const tooLarge = await http()
        .get('/v1/test-problems/too-large')
        .expect(413);
      const unsupported = await http()
        .get('/v1/test-problems/unsupported')
        .expect(415);

      expect(tooLarge.body).toMatchObject({
        type: '/problems/oversized-sample',
        title: 'Contenido demasiado grande',
        status: 413,
      });
      expect(unsupported.body).toMatchObject({
        type: '/problems/odd-format',
        title: 'Formato no admitido',
        status: 415,
      });
    });
  });

  describe('validation (API_SPEC.md §5.3 and §6.1)', () => {
    it('lists each invalid field with its path, code and Spanish message', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .send({
          ...VALID_ORDER,
          quantity: 'two',
          postalCode: '5800',
          lines: [{ quantity: 1 }, { quantity: 0 }],
        })
        .expect(400);

      expect(response.body).toMatchObject({
        type: '/problems/validation-error',
        title: 'Solicitud inválida',
        detail: 'Uno o más campos no son válidos.',
      });
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          {
            field: 'quantity',
            code: 'isInt',
            message: 'Debe ser un número entero.',
          },
          {
            field: 'postalCode',
            code: 'matches',
            message: 'Debe tener 5 dígitos.',
          },
          {
            field: 'lines[1].quantity',
            code: 'min',
            message: 'Es menor que el mínimo permitido.',
          },
        ]),
      );
      expect(response.body.errors).toHaveLength(3);
    });

    it('rejects fields that the endpoint does not declare', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .send({ ...VALID_ORDER, isAdmin: true })
        .expect(400);

      expect(response.body.errors).toEqual([
        {
          field: 'isAdmin',
          code: 'whitelistValidation',
          message: 'No es un campo permitido.',
        },
      ]);
    });

    it('rejects query parameters that the endpoint does not declare', async () => {
      const response = await http()
        .get('/v1/test-problems/search?q=camisa&sort=price')
        .expect(400);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ field: 'sort', code: 'whitelistValidation' }),
      ]);
    });

    it('accepts a valid body', async () => {
      await http()
        .post('/v1/test-problems/orders')
        .send(VALID_ORDER)
        .expect(201);
    });

    it('never echoes the rejected values', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .send({ ...VALID_ORDER, postalCode: 'secret-value' })
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain('secret-value');
    });
  });

  describe('errors raised before or around the application code', () => {
    it('answers a malformed JSON body with a validation problem and a correlation id', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .set('Content-Type', 'application/json')
        .send('{"quantity": ')
        .expect(400);

      expect(response.body.type).toBe('/problems/validation-error');
      expect(response.headers['x-correlation-id']).toBe(
        response.body.correlationId,
      );
    });

    it('answers a body above the size limit with 413', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .send({ ...VALID_ORDER, postalCode: 'x'.repeat(200_000) })
        .expect(413);

      expect(response.body.type).toBe('/problems/payload-too-large');
    });

    it('answers an unsupported charset with 415', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .set('Content-Type', 'application/json; charset=latin1')
        .send(JSON.stringify(VALID_ORDER))
        .expect(415);

      expect(response.body.type).toBe('/problems/unsupported-media-type');
    });

    it('answers a body that is neither JSON nor multipart with 415 (API_SPEC.md §2)', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('quantity=1')
        .expect(415);

      expect(response.body.type).toBe('/problems/unsupported-media-type');
    });

    it('lets a request without a body through, whatever its Content-Type', async () => {
      const response = await http()
        .post('/v1/test-problems/orders')
        .set('Content-Type', 'text/plain')
        .expect(400);

      expect(response.body.type).toBe('/problems/validation-error');
    });

    it('answers a framework HTTP error with the matching problem type', async () => {
      const response = await http()
        .get('/v1/test-problems/framework-forbidden')
        .expect(403);

      expect(response.body.type).toBe('/problems/forbidden');
    });

    it('sends the headers of a ProblemException, such as Retry-After', async () => {
      const response = await http()
        .get('/v1/test-problems/rate-limited')
        .expect(429);

      expect(response.body.type).toBe('/problems/rate-limit-exceeded');
      expect(response.headers['retry-after']).toBe('30');
    });
  });

  describe('unexpected errors', () => {
    it('answers 500 with only the correlation id and logs the stack', async () => {
      loggedErrors.length = 0;

      const response = await http()
        .get('/v1/test-problems/unexpected')
        .expect(500);

      expect(response.body).toEqual({
        type: '/problems/internal-error',
        title: 'Error interno',
        status: 500,
        detail:
          'Ocurrió un error inesperado. Si persiste, comparte el identificador de correlación con soporte.',
        instance: '/v1/test-problems/unexpected',
        correlationId: expect.stringMatching(UUID_V7),
      });
      expect(JSON.stringify(response.body)).not.toContain('hunter2');
      expect(loggedErrors).toHaveLength(1);
      expect(String(loggedErrors[0][0])).toContain(response.body.correlationId);
      expect(String(loggedErrors[0][1])).toContain('hunter2');
    });

    it('treats an HTTP status outside the catalog as unexpected', async () => {
      const response = await http().get('/v1/test-problems/teapot').expect(500);

      expect(response.body.type).toBe('/problems/internal-error');
    });
  });
});
