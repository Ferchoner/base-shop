import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { newId } from '../src/shared-kernel/index.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

const STORE = {
  STORE_NAME: 'Tienda Ejemplo',
  STORE_ADDRESS: 'Av. Madero Poniente 123, Centro, 58000 Morelia, Mich.',
  STORE_TAX_ID: 'eje260101ab1',
  STORE_PHONE: '443 123 4567',
  TICKET_FOOTER: '',
};

/** The data of the store for the ticket of an order (e2e, T-188, UC-ORD-15, ADR-0163). */
describe('Store profile (e2e, T-188)', () => {
  let app: INestApplication<App>;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(STORE)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    // AppModule validates the environment when it loads, so import it after setting the variables.
    const { AppModule } = await import('../src/app.module.js');
    const { configureHttp } =
      await import('../src/platform/http/configure-http.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const staff = (...permissions: ('orders.read' | 'catalog.read')[]) =>
    signedInAs({
      id: newId(),
      type: 'STAFF',
      permissions,
      mustChangePassword: false,
      sessionId: newId(),
    });

  it('gives the staff who reads orders the data of the store, with the RFC in uppercase and the default legend', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/store-profile')
      .set(staff('orders.read'))
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      name: 'Tienda Ejemplo',
      address: 'Av. Madero Poniente 123, Centro, 58000 Morelia, Mich.',
      taxId: 'EJE260101AB1',
      phone: '443 123 4567',
      ticketFooter: 'Este ticket no es un comprobante fiscal.',
    });
  });

  it('asks for orders.read', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/store-profile')
      .set(staff('catalog.read'))
      .expect(403);
  });
});
