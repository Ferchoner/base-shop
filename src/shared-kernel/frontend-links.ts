/**
 * The frontends the emails link to (ADR-0169): the public shop, for customers and guests, and the backoffice, for
 * the staff.
 */
export type Frontend = 'shop' | 'backoffice';

/**
 * Links to pages of the frontends, for emails (ADR-0056, ADR-0110, ADR-0169): the email verification, password
 * recovery and order access links are built on the configured base URL of each frontend.
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class FrontendLinks {
  /**
   * The absolute URL of a page of a frontend, with the parameters in its query string:
   * `link('shop', '/verify-email', { token })` gives `https://shop.example.com/verify-email?token=…`.
   * `path` starts with `/`; parameters are URL-encoded.
   */
  abstract link(
    frontend: Frontend,
    path: string,
    params?: Readonly<Record<string, string>>,
  ): string;
}
