/**
 * Password hashing with Argon2id (ADR-0023, ADR-0114). An abstract class rather than an interface, so it can
 * be the dependency injection token without depending on NestJS.
 */
export abstract class PasswordHasher {
  /** A new hash with its own random salt, in PHC format. */
  abstract hash(password: string): Promise<string>;

  /**
   * Whether the password matches the hash. Without a hash (unknown email, anonymized account) it does the same
   * work against a stand-in hash and answers `false`, so the response time does not reveal whether an account
   * exists (ADR-0062).
   */
  abstract verify(password: string, hash: string | null): Promise<boolean>;
}
