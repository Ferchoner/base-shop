import { type ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authentication of every request (ADR-0022, ADR-0114): with an `Authorization` header, the Passport strategy
 * 'jwt' (JwtStrategy) checks the access token and leaves the user in `request.user`. It never rejects: a
 * missing, invalid or expired token only leaves the request signed out, and AuthorizationGuard answers 401
 * on the routes that need an account. Public routes ignore the token.
 *
 * Registered as a global guard by IdentityAccessModule, which AppModule imports before rate limiting and
 * authorization, so both see who is calling (ADR-0102, ADR-0111).
 */
@Injectable()
export class AccessTokenGuard extends AuthGuard('jwt') {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>();
    if (request.headers.authorization === undefined) return true;
    await super.canActivate(context);
    return true;
  }

  /** The user, or none when the token does not grant access; errors (such as a database failure) propagate. */
  override handleRequest<TUser>(error: unknown, user: unknown): TUser {
    if (error) throw error;
    return (user || undefined) as TUser;
  }
}
