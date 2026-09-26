import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { CatalogModule } from './../src/modules/catalog/index.js';
import { IdentityAccessModule } from './../src/modules/identity-access/index.js';
import { InventoryModule } from './../src/modules/inventory/index.js';
import { OrderingModule } from './../src/modules/ordering/index.js';
import { PaymentsModule } from './../src/modules/payments/index.js';
import { PricingModule } from './../src/modules/pricing/index.js';
import { ShippingModule } from './../src/modules/shipping/index.js';
import { ShoppingModule } from './../src/modules/shopping/index.js';

describe('AppModule (e2e)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('loads one module per bounded context (ADR-0004)', () => {
    for (const contextModule of [
      IdentityAccessModule,
      CatalogModule,
      PricingModule,
      InventoryModule,
      ShoppingModule,
      OrderingModule,
      PaymentsModule,
      ShippingModule,
    ]) {
      expect(moduleFixture.get(contextModule)).toBeInstanceOf(contextModule);
    }
  });

  it('answers unknown routes with 404', () => {
    return request(app.getHttpServer()).get('/v1/any-route').expect(404);
  });
});
