import { type INestApplication, VersioningType } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { ConfigService } from '@nestjs/config';
import helmet, { type HelmetOptions } from 'helmet';
import type { EnvironmentVariables } from '../config/environment.js';
import { setupApiDocs } from './api-docs.js';
import { rejectUnsupportedContentType } from './content-type.js';
import { requestLoggingMiddleware } from '../logging/request-logging.middleware.js';
import { correlationIdMiddleware } from './correlation-id.js';

/**
 * Security response headers (ADR-0086). Every helmet middleware is listed explicitly
 * so a helmet upgrade cannot silently add or change headers.
 */
export const securityHeadersOptions: HelmetOptions = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  xContentTypeOptions: true,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  xPoweredBy: true,
  // HSTS belongs to whoever terminates HTTPS (P-06).
  strictTransportSecurity: false,
  // `same-origin` would block product images loaded by the store from another origin.
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  xDnsPrefetchControl: false,
  xDownloadOptions: false,
  xPermittedCrossDomainPolicies: false,
  xXssProtection: false,
};

/** CORS policy (ADR-0085). No credentials: the API authenticates with `Authorization`, not cookies. */
export function buildCorsOptions(
  allowedOrigins: readonly string[],
): CorsOptions {
  return {
    origin: allowedOrigins.length > 0 ? [...allowedOrigins] : false,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Location', 'Retry-After', 'X-Correlation-Id'],
    maxAge: 600,
  };
}

/** Applies the HTTP policies shared by the running API and the end-to-end tests. */
export function configureHttp(app: INestApplication): void {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  // First, so every response, including body parser errors, carries X-Correlation-Id (ADR-0095).
  app.use(correlationIdMiddleware());
  // Inside the correlation context, so each request line carries its id (ADR-0097).
  app.use(requestLoggingMiddleware);
  app.use(rejectUnsupportedContentType);
  app.use(helmet(securityHeadersOptions));
  app.enableCors(
    buildCorsOptions(config.get('CORS_ALLOWED_ORIGINS', { infer: true })),
  );
  // Every route lives under /v1; a future version is declared with @Version('2') (ADR-0034, ADR-0096).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Swagger UI exists only in local development (ADR-0031, ADR-0096).
  if (config.get('NODE_ENV', { infer: true }) === 'development') {
    setupApiDocs(app);
  }
}
