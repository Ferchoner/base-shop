import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ApiProblemResponses } from './api-problem-responses.decorator.js';

@ApiProblemResponses('unauthenticated', 'forbidden')
@ApiProblemResponses('password-change-required')
@Controller('sample')
class SampleController {
  @Get()
  inherited() {
    return {};
  }

  @ApiProblemResponses('invalid-credentials', 'staff-cannot-purchase')
  @ApiProblemResponses('not-found')
  @Post()
  own() {
    return {};
  }
}

/** The types each response of an operation lists, by status, as the description writes them. */
function typesByStatus(
  responses: Record<string, { description?: string }>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(responses)
      .filter(([status]) => Number(status) >= 400)
      .map(([status, { description }]) => [
        status,
        [...(description ?? '').matchAll(/`([a-z-]+)`/g)]
          .map(([, code]) => code)
          .sort(),
      ]),
  );
}

describe('ApiProblemResponses (ADR-0096, ADR-0155)', () => {
  let app: INestApplication;
  let paths: Record<
    string,
    Record<string, { responses: Record<string, { description?: string }> }>
  >;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    paths = SwaggerModule.createDocument(app, new DocumentBuilder().build())
      .paths as typeof paths;
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives a handler without its own types those of its controller, and the common ones', () => {
    expect(typesByStatus(paths['/sample'].get.responses)).toEqual({
      '400': ['validation-error'],
      '401': ['unauthenticated'],
      '403': ['forbidden', 'password-change-required'],
      '429': ['rate-limit-exceeded'],
      '500': ['internal-error'],
    });
  });

  it('merges the types of a handler with those of its controller of the same status', () => {
    expect(typesByStatus(paths['/sample'].post.responses)).toEqual({
      '400': ['validation-error'],
      '401': ['invalid-credentials', 'unauthenticated'],
      '403': ['forbidden', 'password-change-required', 'staff-cannot-purchase'],
      '404': ['not-found'],
      '429': ['rate-limit-exceeded'],
      '500': ['internal-error'],
    });
  });
});
