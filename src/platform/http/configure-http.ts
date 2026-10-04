import { type INestApplication, VersioningType } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { ConfigService } from '@nestjs/config';
import type {
  NestExpressApplication,
  NestExpressBodyParserOptions,
} from '@nestjs/platform-express';
import helmet, { type HelmetOptions } from 'helmet';
import type { EnvironmentVariables } from '../config/environment.js';
import { buildApiDocument, setupApiDocs } from './api-docs.js';
import { rejectUnsupportedContentType } from './content-type.js';
import { rejectDeeplyNestedJson } from './json-depth.js';
import { requestLoggingMiddleware } from '../logging/request-logging.middleware.js';
import { correlationIdMiddleware } from './correlation-id.js';
import { serveMedia } from './media.js';

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
  // Before any rejection, so every response, a 415 included, carries the security and CORS headers (T-310).
  app.use(helmet(securityHeadersOptions));
  app.enableCors(
    buildCorsOptions(config.get('CORS_ALLOWED_ORIGINS', { infer: true })),
  );
  app.use(rejectUnsupportedContentType);
  // The JSON body parser of NestJS, with its 100 kB limit, which also rejects bodies nested too deep (T-310); NestJS
  // then does not add its own. It keeps `verify` for raw bodies, which the API does not use.
  const jsonOptions: NestExpressBodyParserOptions = {
    limit: '100kb',
    verify: rejectDeeplyNestedJson,
  };
  (app as NestExpressApplication).useBodyParser('json', jsonOptions);
  // Stored product images at /media, after helmet so they get its headers (ADR-0121).
  serveMedia(app, config.get('IMAGE_STORAGE_DIR', { infer: true }));
  // Every route lives under /v1; a future version is declared with @Version('2') (ADR-0034, ADR-0096).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // The OpenAPI document is built and checked outside production, so a DTO that breaks it fails any suite;
  // Swagger UI exists only in local development (ADR-0031, ADR-0096).
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  if (nodeEnv !== 'production') {
    const document = buildApiDocument(app);
    if (nodeEnv === 'development') setupApiDocs(app, document);
  }
}
