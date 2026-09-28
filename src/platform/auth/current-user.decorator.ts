import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import {
  type AuthenticatedUser,
  authenticatedUserOf,
} from './authenticated-user.js';

/**
 * The signed-in user of a route protected with `@RequirePermissions` or `@RequireAccount` (ADR-0111): the
 * guard has already rejected requests without one. Use its `id` for the user's own resources, never an ID
 * from the URL (ADR-0036).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = authenticatedUserOf(context.switchToHttp().getRequest());
    if (user === undefined) {
      throw new Error(
        '@CurrentUser needs @RequirePermissions or @RequireAccount',
      );
    }
    return user;
  },
);
