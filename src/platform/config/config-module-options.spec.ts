import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { configModuleOptions } from './config-module-options.js';
import type { EnvironmentVariables } from './environment.js';

/** Variables of `.env.example` that it leaves empty, and that mean "not set" (ADR-0114, ADR-0152). */
const EMPTY = {
  JWT_SECRET: '',
  INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS: '',
};

describe('configModuleOptions', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, EMPTY, {
      DATABASE_URL: 'postgresql://shop:example@localhost:5432/shop',
    });
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('reads an empty variable as not set, not as the raw empty string', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(configModuleOptions())],
    }).compile();
    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

    expect(config.get('JWT_SECRET', { infer: true })).toBeUndefined();
    expect(
      config.get('INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS', { infer: true }),
    ).toBeUndefined();
    expect(config.get('PORT', { infer: true })).toBe(3000);
  });
});
