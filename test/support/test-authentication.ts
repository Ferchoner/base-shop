import type { INestApplication } from '@nestjs/common';
import type { AuthenticatedUser } from '../../src/platform/auth/authenticated-user.js';

/** Test-only header carrying the signed-in user as JSON. The API itself never reads it. */
const TEST_USER_HEADER = 'x-test-user';

/**
 * Stands in for authentication (T-120) in end-to-end tests: puts the user of the `x-test-user` header in
 * `request.user`, as the JWT strategy will. It only exists under `test/`, so it can never reach the API.
 */
export function useTestAuthentication(app: INestApplication): void {
  app.use(
    (
      request: { headers: Record<string, unknown>; user?: unknown },
      _response: unknown,
      next: () => void,
    ) => {
      const header = request.headers[TEST_USER_HEADER];
      if (typeof header === 'string') request.user = JSON.parse(header);
      next();
    },
  );
}

/** Headers of a request made by `user`: `.set(signedInAs(user))`. */
export function signedInAs(user: AuthenticatedUser): Record<string, string> {
  return { [TEST_USER_HEADER]: JSON.stringify(user) };
}
