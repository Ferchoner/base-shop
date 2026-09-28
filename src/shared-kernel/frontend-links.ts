/**
 * Links to pages of the frontend, for emails (ADR-0056, ADR-0110): the email verification and password
 * recovery links are built on the configured frontend base URL.
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class FrontendLinks {
  /**
   * The absolute URL of a frontend page, with the parameters in its query string:
   * `link('/verify-email', { token })` gives `https://shop.example.com/verify-email?token=…`.
   * `path` starts with `/`; parameters are URL-encoded.
   */
  abstract link(
    path: string,
    params?: Readonly<Record<string, string>>,
  ): string;
}
