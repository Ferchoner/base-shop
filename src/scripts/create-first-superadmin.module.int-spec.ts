import { FirstSuperadminCommand } from '../modules/identity-access/index.js';
import { CreateFirstSuperadminScriptModule } from './create-first-superadmin.module.js';
import { Test } from '@nestjs/testing';

/**
 * The module of `create-first-superadmin` resolves every dependency of Identity & Access on its own, without the
 * modules of the API (UC-IAM-20, ADR-0116).
 */
describe('create-first-superadmin script module', () => {
  it('starts with the empty values of .env.example and provides the command', async () => {
    const original = { ...process.env };
    Object.assign(process.env, {
      JWT_SECRET: '',
      INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS: '',
    });
    try {
      const app = await Test.createTestingModule({
        imports: [CreateFirstSuperadminScriptModule],
      }).compile();
      await app.init();
      try {
        expect(app.get(FirstSuperadminCommand)).toBeInstanceOf(
          FirstSuperadminCommand,
        );
      } finally {
        await app.close();
      }
    } finally {
      process.env = original;
    }
  });
});
