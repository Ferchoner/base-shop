import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { contentSecurityPolicy } from 'helmet';
import { ProblemDetailsSchema } from './problem-details/problem-details.schema.js';

/** What a path parameter is, in OpenAPI. */
interface PathParameter {
  readonly description: string;
  readonly format?: 'uuid';
  readonly example?: string;
}

const uuid = (description: string): PathParameter => ({
  description,
  format: 'uuid',
});

/**
 * Every path parameter of the API by name (ADR-0155): a name means the same in every route, so it is described once
 * here rather than on each handler. An ID that is not a UUID answers 404, like a missing resource (`pathId`). A new
 * name needs its entry; the API contract test fails until then.
 */
export const PATH_PARAMETERS: Readonly<Record<string, PathParameter>> = {
  addressId: uuid('ID de la dirección.'),
  brandId: uuid('ID de la marca.'),
  cartId: uuid(
    'ID del carrito de invitado; es la única credencial del carrito (ADR-0059).',
  ),
  categoryId: uuid('ID de la categoría.'),
  deliveryId: uuid('ID de la entrega de un evento a su manejador.'),
  imageId: uuid('ID de la imagen.'),
  orderId: uuid('ID interno del pedido; quien compra usa el código público.'),
  paymentId: uuid('ID del pago.'),
  periodId: uuid('ID del periodo de precio.'),
  priceListId: uuid('ID de la lista de precios.'),
  productId: uuid('ID del producto.'),
  publicCode: {
    description:
      'Código público del pedido, de 8 caracteres, con o sin el guion del medio y sin distinguir mayúsculas.',
    example: 'K7M4-Q9XA',
  },
  roleId: uuid('ID del rol.'),
  shipmentId: uuid('ID del envío.'),
  slug: {
    description: 'Slug del producto publicado.',
    example: 'camisa-de-lino',
  },
  stateCode: {
    description: 'Clave del estado en el catálogo del INEGI, de dos dígitos.',
    example: '16',
  },
  stockItemId: uuid('ID de las existencias de una variante en un almacén.'),
  userId: uuid('ID de la cuenta.'),
  variantId: uuid('ID de la variante.'),
  warehouseId: uuid('ID del almacén.'),
};

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
  describePathParameters(document);
  const missing = unresolvedRefs(document);
  if (missing.length > 0) {
    throw new Error(
      `The OpenAPI document refers to schemas it does not have: ${missing.join(', ')}`,
    );
  }
  return document;
}

/** Gives each path parameter that its route leaves undescribed the text and format of `PATH_PARAMETERS`. */
export function describePathParameters(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item as Record<string, unknown>)) {
      const parameters = (operation as { parameters?: unknown[] }).parameters;
      for (const parameter of parameters ?? []) {
        const {
          in: location,
          name,
          description,
          schema,
        } = parameter as {
          in: string;
          name: string;
          description?: string;
          schema?: Record<string, unknown>;
        };
        const known = PATH_PARAMETERS[name];
        if (location !== 'path' || description || known === undefined) {
          continue;
        }
        Object.assign(parameter as object, {
          description: known.description,
          ...(known.example === undefined ? {} : { example: known.example }),
          schema: {
            ...schema,
            ...(known.format === undefined ? {} : { format: known.format }),
          },
        });
      }
    }
  }
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
