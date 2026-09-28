import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AuthenticatedUser } from '../src/platform/auth/authenticated-user.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const ADDRESS = {
  recipientName: 'María López Hernández',
  phone: '4431234567',
  street: 'Av. Madero Poniente',
  exteriorNumber: '123',
  interiorNumber: '4B',
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: 'Morelia',
  references: 'Entre Galeana e Hidalgo',
};

/** The customer address book over HTTP (T-130 part c, UC-IAM-11, API_SPEC.md §9.14). */
describe('My addresses (e2e, T-130)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let customer: AuthenticatedUser;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const [code, name] of [
      ['16', 'Michoacán de Ocampo'],
      ['14', 'Jalisco'],
    ]) {
      await prisma.geoState.upsert({
        where: { code },
        create: { code, name },
        update: {},
      });
    }
    for (const [code, stateCode, name] of [
      ['16053', '16', 'Morelia'],
      ['14039', '14', 'Guadalajara'],
    ]) {
      await prisma.geoMunicipality.upsert({
        where: { code },
        create: { code, stateCode, name, isActive: true },
        update: {},
      });
    }
  });

  beforeEach(async () => {
    customer = await insertCustomer();
  });

  afterEach(async () => {
    await prisma.customerAddress.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function insertCustomer(): Promise<AuthenticatedUser> {
    const id = newId();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        // Not a real hash: these tests never sign in.
        passwordHash: 'not-a-real-hash',
      },
    });
    return { id, type: 'CUSTOMER', permissions: [], mustChangePassword: false };
  }

  const http = () => request(app.getHttpServer());
  const create = (body: object = ADDRESS, user = customer) =>
    http().post('/v1/me/addresses').set(signedInAs(user)).send(body);

  it('is only for signed-in customers', async () => {
    await http().get('/v1/me/addresses').expect(401);
    await http()
      .get('/v1/me/addresses')
      .set(
        signedInAs({
          id: newId(),
          type: 'STAFF',
          permissions: ['customers.read'],
          mustChangePassword: false,
        }),
      )
      .expect(403);
  });

  it('adds the first address as the default, with its Location and names', async () => {
    const response = await create().expect(201);

    expect(response.headers.location).toBe(
      `/v1/me/addresses/${response.body.id}`,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      ...ADDRESS,
      stateName: 'Michoacán de Ocampo',
      municipalityName: 'Morelia',
      country: 'MX',
      isDefault: true,
    });
  });

  it('lists my addresses, the default first', async () => {
    const first = (await create().expect(201)).body;
    const second = (
      await create({
        ...ADDRESS,
        street: 'Calle Real',
        isDefault: true,
      }).expect(201)
    ).body;

    const response = await http()
      .get('/v1/me/addresses')
      .set(signedInAs(customer))
      .expect(200);

    expect(response.body.data.map((a: { id: string }) => a.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('changes only the fields sent, and clears the optional ones with null', async () => {
    const address = (await create().expect(201)).body;

    const response = await http()
      .patch(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(customer))
      .send({ street: 'Calle Real', interiorNumber: null })
      .expect(200);

    expect(response.body).toMatchObject({
      street: 'Calle Real',
      interiorNumber: null,
      city: 'Morelia',
    });
  });

  it('asks for the municipality when the state changes, and checks it belongs to the state', async () => {
    const address = (await create().expect(201)).body;

    const missing = await http()
      .patch(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(customer))
      .send({ stateCode: '14' })
      .expect(400);
    expect(missing.body.errors).toEqual([
      expect.objectContaining({
        field: 'municipalityCode',
        message: 'Es obligatorio si cambia el estado.',
      }),
    ]);
    const wrong = await http()
      .patch(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(customer))
      .send({ stateCode: '14', municipalityCode: '16053' })
      .expect(400);
    expect(wrong.body.errors).toEqual([
      {
        field: 'municipalityCode',
        code: 'isMunicipalityOfState',
        message: 'El municipio no pertenece al estado elegido.',
      },
    ]);
    await http()
      .patch(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(customer))
      .send({ stateCode: '14', municipalityCode: '14039' })
      .expect(200)
      .expect((res) => expect(res.body.municipalityName).toBe('Guadalajara'));
  });

  it.each([
    [
      { ...ADDRESS, phone: '443-123-4567' },
      'phone',
      'Debe tener exactamente 10 dígitos.',
    ],
    [{ ...ADDRESS, postalCode: '5800' }, 'postalCode', 'Debe tener 5 dígitos.'],
    [
      { ...ADDRESS, recipientName: '  ' },
      'recipientName',
      'No puede estar vacío.',
    ],
  ])('rejects %o', async (body, field, message) => {
    const response = await create(body).expect(400);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ field, message }),
    ]);
  });

  it('rejects null in a required field of a change', async () => {
    const address = (await create().expect(201)).body;

    await http()
      .patch(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(customer))
      .send({ recipientName: null })
      .expect(400);
  });

  it('answers 409 address-limit-reached with the limit', async () => {
    await prisma.customerAddress.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        id: newId(),
        userId: customer.id,
        recipientName: 'María López',
        phone: '4431234567',
        street: 'Av. Madero',
        exteriorNumber: String(i + 1),
        neighborhood: 'Centro',
        postalCode: '58000',
        stateCode: '16',
        municipalityCode: '16053',
        isDefault: i === 0,
      })),
    });

    const response = await create().expect(409);

    expect(response.body).toMatchObject({
      type: '/problems/address-limit-reached',
      limit: 10,
    });
  });

  it("deletes my address, and answers another customer's as missing", async () => {
    const address = (await create().expect(201)).body;
    const other = await insertCustomer();

    await http()
      .delete(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(other))
      .expect(404);
    await http()
      .patch(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(other))
      .send({ street: 'X' })
      .expect(404);
    await http()
      .delete(`/v1/me/addresses/${address.id}`)
      .set(signedInAs(customer))
      .expect(204);
    await http()
      .delete('/v1/me/addresses/not-a-uuid')
      .set(signedInAs(customer))
      .expect(404);
  });
});
