import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

const ALLOWED_ORIGIN = 'https://shop.example.test';

describe('HTTP policies (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // ConfigModule validates the environment when AppModule is loaded, so set it first.
    process.env.CORS_ALLOWED_ORIGINS = ALLOWED_ORIGIN;
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } = await import('../src/http/configure-http.js');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  describe('security headers (ADR-0086)', () => {
    it('sends the agreed headers and nothing that belongs to other layers', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none';frame-ancestors 'none'",
      );
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers).not.toHaveProperty('x-powered-by');
      expect(response.headers).not.toHaveProperty('strict-transport-security');
      expect(response.headers).not.toHaveProperty(
        'cross-origin-resource-policy',
      );
      expect(response.headers).not.toHaveProperty('x-xss-protection');
    });
  });

  describe('CORS (ADR-0085)', () => {
    it('allows a configured origin and exposes the agreed headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .set('Origin', ALLOWED_ORIGIN)
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        ALLOWED_ORIGIN,
      );
      expect(response.headers['access-control-expose-headers']).toBe(
        'Location,Retry-After,X-Correlation-Id',
      );
      expect(response.headers).not.toHaveProperty(
        'access-control-allow-credentials',
      );
    });

    it('does not allow an origin outside the list', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .set('Origin', 'https://evil.example.test')
        .expect(200);

      expect(response.headers).not.toHaveProperty(
        'access-control-allow-origin',
      );
    });

    it('answers the preflight with the agreed methods, headers and cache time', async () => {
      const response = await request(app.getHttpServer())
        .options('/')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Authorization, Idempotency-Key')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe(
        ALLOWED_ORIGIN,
      );
      expect(response.headers['access-control-allow-methods']).toBe(
        'GET,POST,PUT,PATCH,DELETE',
      );
      expect(response.headers['access-control-allow-headers']).toBe(
        'Authorization,Content-Type,Idempotency-Key',
      );
      expect(response.headers['access-control-max-age']).toBe('600');
    });
  });
});
