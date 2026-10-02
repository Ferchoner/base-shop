import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
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
 * The OpenAPI document of `v1` (ADR-0034, ADR-0096), checked: building it fails on a DTO it cannot describe, such as
 * one whose type it reads as a circular dependency, and every `$ref` must name a schema of the document. configureHttp
 * builds it outside production, so every end-to-end suite does, with the Swagger plugin (Sprint 6 step 0).
 *
 * @throws Error naming each `$ref` without its schema.
 */
export function buildApiDocument(app: INestApplication): OpenAPIObject {
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
  const missing = unresolvedRefs(document);
  if (missing.length > 0) {
    throw new Error(
      `The OpenAPI document refers to schemas it does not have: ${missing.join(', ')}`,
    );
  }
  return document;
}

/** Every `$ref` of the document whose schema is not in `components.schemas`, once each and sorted. */
export function unresolvedRefs(document: OpenAPIObject): string[] {
  const schemas = document.components?.schemas ?? {};
  const missing = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') {
        const name = entry.replace('#/components/schemas/', '');
        if (!entry.startsWith('#/components/schemas/') || !(name in schemas)) {
          missing.add(entry);
        }
      } else {
        visit(entry);
      }
    }
  };
  visit(document);
  return [...missing].sort();
}

/**
 * Serves Swagger UI and the OpenAPI document of `v1` (ADR-0034, ADR-0096). Only for local development:
 * configureHttp calls it when NODE_ENV is `development` (ADR-0031).
 */
export function setupApiDocs(
  app: INestApplication,
  document: OpenAPIObject,
): void {
  // After the global helmet middleware, so this CSP replaces the strict one on these routes only.
  app.use(`/${API_DOCS_PATH}`, contentSecurityPolicy(API_DOCS_CSP));
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: `${API_DOCS_PATH}/openapi.json`,
    raw: ['json'],
    customSiteTitle: 'base-shop API v1',
  });
}
