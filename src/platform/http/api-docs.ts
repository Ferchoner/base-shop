import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { contentSecurityPolicy } from 'helmet';
import { ProblemDetailsSchema } from './problem-details/problem-details.schema.js';

/** Swagger UI of API version 1; its OpenAPI document is at `/docs/v1/openapi.json` (ADR-0096). */
export const API_DOCS_PATH = 'docs/v1';

/**
 * CSP for Swagger UI only (ADR-0086): its scripts, styles and images come from this server, and it applies
 * inline styles. Every other route keeps `default-src 'none'`.
 */
export const API_DOCS_CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
  },
};

/**
 * Serves Swagger UI and the OpenAPI document of `v1` (ADR-0034, ADR-0096). Only for local development:
 * configureHttp calls it when NODE_ENV is `development` (ADR-0031).
 */
export function setupApiDocs(app: INestApplication): void {
  // After the global helmet middleware, so this CSP replaces the strict one on these routes only.
  app.use(`/${API_DOCS_PATH}`, contentSecurityPolicy(API_DOCS_CSP));

  const config = new DocumentBuilder()
    .setTitle('base-shop API')
    .setDescription(
      'API REST de comercio electrónico. Contratos de referencia en docs/API_SPEC.md; errores en formato Problem Details (RFC 9457).',
    )
    .setVersion('1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ProblemDetailsSchema],
  });
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: `${API_DOCS_PATH}/openapi.json`,
    raw: ['json'],
    customSiteTitle: 'base-shop API v1',
  });
}
