import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { authenticatedUserOf } from '../../../platform/auth/authenticated-user.js';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';

/**
 * Staff accounts never have a cart nor buy (BR-USR-08, BR-CRT-08): with a staff token, the cart routes that
 * create or change a cart answer 403 `staff-cannot-purchase` (E-09, ADR-0131). Without a token, or with a
 * customer's, the request goes on.
 */
@Injectable()
export class NoStaffPurchases implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = authenticatedUserOf(context.switchToHttp().getRequest());
    if (user?.type === 'STAFF') {
      throw new ProblemException('staff-cannot-purchase');
    }
    return true;
  }
}
