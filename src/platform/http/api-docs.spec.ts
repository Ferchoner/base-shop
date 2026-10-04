import type { OpenAPIObject } from '@nestjs/swagger';
import { describePathParameters, unresolvedRefs } from './api-docs.js';

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

/** The path parameters of the document (ADR-0155). */
describe('describePathParameters', () => {
  const operation = (parameters: object[]) =>
    ({
      openapi: '3.0.0',
      info: { title: 'base-shop API', version: '1' },
      paths: {
        '/v1/items/{productId}': { get: { parameters, responses: {} } },
      },
    }) as unknown as OpenAPIObject;
  const parametersOf = (document: OpenAPIObject) =>
    (document.paths['/v1/items/{productId}'].get as { parameters: object[] })
      .parameters;

  it('describes a known path parameter with its text, format and example', () => {
    const document = operation([
      {
        in: 'path',
        name: 'productId',
        required: true,
        schema: { type: 'string' },
      },
      {
        in: 'path',
        name: 'publicCode',
        required: true,
        schema: { type: 'string' },
      },
    ]);

    describePathParameters(document);

    expect(parametersOf(document)).toEqual([
      {
        in: 'path',
        name: 'productId',
        required: true,
        description: 'ID del producto.',
        schema: { type: 'string', format: 'uuid' },
      },
      expect.objectContaining({
        name: 'publicCode',
        example: 'K7M4-Q9XA',
        schema: { type: 'string' },
      }),
    ]);
  });

  it('keeps the description a route gives, and leaves query parameters and unknown names alone', () => {
    const own = {
      in: 'path',
      name: 'productId',
      description: 'Propia.',
      schema: { type: 'string' },
    };
    const query = {
      in: 'query',
      name: 'productId',
      schema: { type: 'string' },
    };
    const unknown = { in: 'path', name: 'otherId', schema: { type: 'string' } };
    const document = operation([own, query, unknown]);

    describePathParameters(document);

    expect(parametersOf(document)).toEqual([
      {
        in: 'path',
        name: 'productId',
        description: 'Propia.',
        schema: { type: 'string' },
      },
      { in: 'query', name: 'productId', schema: { type: 'string' } },
      { in: 'path', name: 'otherId', schema: { type: 'string' } },
    ]);
  });
});
