import type { INestApplication } from '@nestjs/common';
import type { AuthenticatedUser } from '../../src/platform/auth/authenticated-user.js';

/** Test-only header carrying the signed-in user as JSON. The API itself never reads it. */
const TEST_USER_HEADER = 'x-test-user';

/**
 * Stands in for authentication in end-to-end tests of authorization and of the routes behind it: puts the
 * user of the `x-test-user` header in `request.user`, as the JWT strategy does (ADR-0114). Requests without
 * `Authorization` keep it. It only exists under `test/`, so it can never reach the API; the tests of
 * authentication itself sign in for real.
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
