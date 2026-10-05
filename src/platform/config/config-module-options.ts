import type { ConfigModuleOptions } from '@nestjs/config';
import { validateEnvironment } from './environment.js';

/**
 * Options of `ConfigModule.forRoot` for the API and the operator scripts, so both read the environment the same way.
 *
 * `skipProcessEnv`: `ConfigService.get` answers only with the validated values. Without it, a variable the
 * validation leaves undefined, such as an empty `JWT_SECRET=` from `.env.example`, falls back to its raw `''` in
 * the process: the API then failed to start, and an empty `INACTIVE_CUSTOMER_ANONYMIZATION_MONTHS` read as 0
 * months instead of "never".
 */
export function configModuleOptions(): ConfigModuleOptions {
  return {
    isGlobal: true,
    cache: true,
    skipProcessEnv: true,
    // Tests read their variables only from the process, so a local .env cannot change their results.
    ignoreEnvFile: process.env.NODE_ENV === 'test',
    validate: validateEnvironment,
  };
}
