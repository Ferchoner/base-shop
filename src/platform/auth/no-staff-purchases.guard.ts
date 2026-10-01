import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ProblemException } from '../http/problem-details/problem.exception.js';
import { authenticatedUserOf } from './authenticated-user.js';

/**
 * Staff accounts never have a cart nor buy (BR-USR-08, BR-CRT-08): with a staff token, the cart routes that
 * create or change a cart, and the checkout routes, answer 403 `staff-cannot-purchase` (E-09, ADR-0131,
 * ADR-0132). Without a token, or with a customer's, the request goes on.
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
