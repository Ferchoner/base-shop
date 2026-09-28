import path from 'node:path';
import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { GeoCatalogImportCommand } from '../src/modules/geo/index.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';

const INEGI_FILE = path.join(
  process.cwd(),
  'data',
  'inegi',
  'municipios-2026-06.csv',
);

/** Public geographic catalog (T-124, UC-IAM-22, API_SPEC.md §10), loaded with the real INEGI file. */
describe('Geographic catalog (e2e, T-124)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    // In development, so the OpenAPI document is served too (ADR-0096).
    const config = app.get(ConfigService);
    const realGet = config.get.bind(config) as (key: string) => unknown;
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'development' : realGet(key),
      );
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    expect(await app.get(GeoCatalogImportCommand).run([INEGI_FILE])).toBe(0);
    // A municipality that left the catalog: kept, but no longer offered.
    await prisma.geoMunicipality.update({
      where: { code: '09010' },
      data: { isActive: false },
    });
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const http = () => request(app.getHttpServer());

  it('lists the 32 states by name, publicly', async () => {
    const response = await http()
      .get('/v1/geo/states')
      .expect(200)
      .expect('Content-Type', /application\/json/);

    const states = response.body.data as { code: string; name: string }[];
    expect(states).toHaveLength(32);
    expect(states[0]).toEqual({ code: '01', name: 'Aguascalientes' });
    expect(states).toContainEqual({ code: '16', name: 'Michoacán de Ocampo' });
    expect(Object.keys(states[0])).toEqual(['code', 'name']);
  });

  it('lists only the active municipalities of a state, by name and with accents', async () => {
    const response = await http()
      .get('/v1/geo/states/09/municipalities')
      .expect(200);

    const municipalities = response.body.data as {
      code: string;
      name: string;
    }[];
    expect(municipalities).toHaveLength(15);
    expect(municipalities.map((m) => m.code)).not.toContain('09010');
    expect(municipalities[0]).toEqual({ code: '09002', name: 'Azcapotzalco' });
    expect(municipalities).toContainEqual({
      code: '09003',
      name: 'Coyoacán',
    });
  });

  it('serves repeated reads from the cache for up to the TTL (ADR-0028)', async () => {
    await prisma.geoMunicipality.update({
      where: { code: '09010' },
      data: { isActive: true },
    });

    const response = await http()
      .get('/v1/geo/states/09/municipalities')
      .expect(200);

    expect(response.body.data).toHaveLength(15);
  });

  it.each(['99', 'ab', '123'])(
    'answers 404 not-found for state %s',
    async (stateCode) => {
      const response = await http()
        .get(`/v1/geo/states/${stateCode}/municipalities`)
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body).toMatchObject({
        type: '/problems/not-found',
        status: 404,
      });
    },
  );

  it('documents both endpoints and their responses in OpenAPI', async () => {
    const response = await http().get('/docs/v1/openapi.json').expect(200);
    const document = response.body as {
      paths: Record<
        string,
        {
          get: {
            tags: string[];
            responses: Record<
              string,
              { content?: Record<string, { schema: { $ref?: string } }> }
            >;
          };
        }
      >;
      components: { schemas: Record<string, unknown> };
    };

    const states = document.paths['/v1/geo/states'].get;
    const municipalities =
      document.paths['/v1/geo/states/{stateCode}/municipalities'].get;
    expect(states.tags).toEqual(['Catálogo geográfico']);
    expect(
      states.responses['200'].content?.['application/json'].schema.$ref,
    ).toBe('#/components/schemas/GeoStateListDto');
    expect(
      municipalities.responses['200'].content?.['application/json'].schema.$ref,
    ).toBe('#/components/schemas/GeoMunicipalityListDto');
    expect(municipalities.responses['404']).toBeDefined();
    expect(document.components.schemas.GeoMunicipalityDto).toMatchObject({
      properties: {
        code: { type: 'string', example: '16053' },
        name: { type: 'string', example: 'Morelia' },
      },
    });
  });
});
