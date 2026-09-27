import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { ApiDocsSampleController } from './fixtures/api-docs-sample.controller.js';

const STRICT_CSP = "default-src 'none';frame-ancestors 'none'";

/** Builds the application as main.ts does, pretending NODE_ENV has the given value. */
async function createApp(nodeEnv: string): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ApiDocsSampleController],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  const config = app.get(ConfigService);
  const realGet = config.get.bind(config) as (key: string) => unknown;
  jest
    .spyOn(config, 'get')
    .mockImplementation((key: string) =>
      key === 'NODE_ENV' ? nodeEnv : realGet(key),
    );
  configureHttp(app);
  await app.init();
  return app;
}

describe('Versioning and API docs (e2e, T-114)', () => {
  describe('in development', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp('development');
    });

    afterAll(async () => {
      await app.close();
      jest.restoreAllMocks();
    });

    const http = () => request(app.getHttpServer());

    it('serves every route under /v1 (ADR-0034)', async () => {
      await http().get('/v1/api-docs-sample/items').expect(200);
      await http().get('/api-docs-sample/items').expect(404);
    });

    it('serves Swagger UI with its own CSP', async () => {
      const response = await http()
        .get('/docs/v1')
        .expect(200)
        .expect('Content-Type', /text\/html/);

      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('keeps the strict CSP on the API routes (ADR-0086)', async () => {
      const response = await http().get('/v1/api-docs-sample/items');

      expect(response.headers['content-security-policy']).toBe(STRICT_CSP);
    });

    describe('OpenAPI document', () => {
      let document: {
        openapi: string;
        info: { version: string };
        paths: Record<string, Record<string, OperationObject>>;
        components: {
          schemas: Record<string, SchemaObject>;
          securitySchemes: Record<string, { type: string; scheme: string }>;
        };
      };

      interface SchemaObject {
        properties: Record<string, Record<string, unknown>>;
        required?: string[];
      }

      interface OperationObject {
        responses: Record<
          string,
          { content?: Record<string, { schema: { $ref: string } }> }
        >;
      }

      beforeAll(async () => {
        const response = await http()
          .get('/docs/v1/openapi.json')
          .expect(200)
          .expect('Content-Type', /application\/json/);
        document = response.body as typeof document;
      });

      it('describes version 1 with its /v1 paths', () => {
        expect(document.openapi).toMatch(/^3\./);
        expect(document.info.version).toBe('1');
        expect(Object.keys(document.paths)).toContain(
          '/v1/api-docs-sample/items',
        );
      });

      it('documents DTO fields from their types, validation rules and comments (Swagger plugin)', () => {
        const schema = document.components.schemas.CreateSampleItemDto;

        expect(schema.properties.name).toMatchObject({
          type: 'string',
          maxLength: 80,
          description: 'Nombre visible del artículo.',
        });
        expect(schema.properties.quantity).toMatchObject({
          type: 'number',
          minimum: 1,
        });
        expect(schema.required).toEqual(['name', 'quantity']);
      });

      it('documents the error responses with the Problem Details schema', () => {
        const responses =
          document.paths['/v1/api-docs-sample/items'].post.responses;

        expect(Object.keys(responses)).toEqual(
          expect.arrayContaining(['400', '404', '409', '429', '500']),
        );
        expect(
          responses['409'].content?.['application/problem+json'].schema.$ref,
        ).toBe('#/components/schemas/ProblemDetails');
        expect(
          document.components.schemas.ProblemDetails.properties.type.enum,
        ).toEqual(expect.arrayContaining(['/problems/version-conflict']));
      });

      it('declares Bearer authentication for the endpoints that will need it', () => {
        expect(document.components.securitySchemes.bearer).toMatchObject({
          type: 'http',
          scheme: 'bearer',
        });
      });
    });
  });

  describe('outside development', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp('production');
    });

    afterAll(async () => {
      await app.close();
      jest.restoreAllMocks();
    });

    it('does not serve Swagger UI nor the OpenAPI document (ADR-0031)', async () => {
      await request(app.getHttpServer()).get('/docs/v1').expect(404);
      await request(app.getHttpServer())
        .get('/docs/v1/openapi.json')
        .expect(404);
    });

    it('still serves the API under /v1', async () => {
      await request(app.getHttpServer())
        .get('/v1/api-docs-sample/items')
        .expect(200);
    });
  });
});
