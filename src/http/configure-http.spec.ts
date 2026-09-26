import { buildCorsOptions, securityHeadersOptions } from './configure-http.js';

describe('buildCorsOptions', () => {
  it('disables CORS when no origin is allowed', () => {
    expect(buildCorsOptions([]).origin).toBe(false);
  });

  it('allows only the configured origins, without credentials', () => {
    const options = buildCorsOptions(['https://shop.example.com']);

    expect(options).toEqual({
      origin: ['https://shop.example.com'],
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['Location', 'Retry-After', 'X-Correlation-Id'],
      maxAge: 600,
    });
  });
});

describe('securityHeadersOptions', () => {
  it('leaves HSTS and Cross-Origin-Resource-Policy to other layers', () => {
    expect(securityHeadersOptions.strictTransportSecurity).toBe(false);
    expect(securityHeadersOptions.crossOriginResourcePolicy).toBe(false);
  });
});
