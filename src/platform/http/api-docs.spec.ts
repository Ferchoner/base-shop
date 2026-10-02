import type { OpenAPIObject } from '@nestjs/swagger';
import { unresolvedRefs } from './api-docs.js';

const document = (schemas: string[], body: unknown): OpenAPIObject =>
  ({
    openapi: '3.0.0',
    info: { title: 'base-shop API', version: '1' },
    paths: { '/v1/items': { get: { responses: { 200: body } } } },
    components: {
      schemas: Object.fromEntries(schemas.map((name) => [name, {}])),
    },
  }) as unknown as OpenAPIObject;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** The check of the OpenAPI document (ADR-0096, Sprint 6 step 0). */
describe('unresolvedRefs', () => {
  it('finds nothing when every reference names a schema of the document', () => {
    expect(
      unresolvedRefs(
        document(['ItemDto', 'MoneyDto'], {
          content: {
            'application/json': {
              schema: {
                allOf: [ref('ItemDto')],
                properties: {
                  prices: { type: 'array', items: ref('MoneyDto') },
                },
              },
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('names each reference without its schema once, however deep, sorted', () => {
    expect(
      unresolvedRefs(
        document(['ItemDto'], {
          content: {
            'application/json': {
              schema: {
                oneOf: [ref('ItemDto'), ref('MissingDto'), ref('MissingDto')],
                properties: { tags: { items: ref('AlsoMissingDto') } },
              },
            },
          },
        }),
      ),
    ).toEqual([
      '#/components/schemas/AlsoMissingDto',
      '#/components/schemas/MissingDto',
    ]);
  });

  it('names a reference that points outside the schemas of the document', () => {
    expect(
      unresolvedRefs(document([], { $ref: '#/components/responses/NotFound' })),
    ).toEqual(['#/components/responses/NotFound']);
  });

  it('finds nothing in a document without schemas nor references', () => {
    expect(
      unresolvedRefs({
        openapi: '3.0.0',
        info: { title: 'base-shop API', version: '1' },
        paths: {},
      } as unknown as OpenAPIObject),
    ).toEqual([]);
  });
});
