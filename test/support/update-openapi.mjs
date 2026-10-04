// Writes docs/openapi/v1.json from the running application (ADR-0155): the API contract test writes the OpenAPI
// document it generates instead of only comparing it. Needs Docker, like every end-to-end test.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    'node_modules/jest/bin/jest.js',
    '--config',
    './test/jest-e2e.json',
    '--runInBand',
    'test/api-contract',
    '--testNamePattern',
    'is the document the application generates',
  ],
  { stdio: 'inherit', env: { ...process.env, OPENAPI_UPDATE: 'true' } },
);
process.exit(result.status ?? 1);
