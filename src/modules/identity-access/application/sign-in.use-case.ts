import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  Clock,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { SessionRepository } from '../domain/session.repository.js';
import { normalizeEmail, type User, type UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { PasswordHasher } from './password-hasher.js';
import { type IssuedTokens, SessionTokens } from './session-tokens.js';

/**
 * How a sign-in ended (ADR-0048). A staff member with a temporary password is still `AUTHENTICATED`, with
 * `mustChangePassword`, because they get tokens (API_SPEC.md §9.5); a future second factor would be another
 * outcome, without tokens. The API answers both failures the same way (ADR-0062).
 */
export type SignInResult =
  | {
      readonly outcome: 'AUTHENTICATED';
      readonly userId: UserId;
      readonly mustChangePassword: boolean;
      readonly tokens: IssuedTokens;
    }
  | { readonly outcome: 'INVALID_CREDENTIALS' }
  | { readonly outcome: 'ACCOUNT_DISABLED' };

/**
 * Signs in with email and password (UC-IAM-04): a new session, audited. Failures are audited on their own,
 * since nothing else is written (ADR-0037). Limiting failed attempts is up to the caller, which knows the IP
 * (ADR-0102).
 */
@Injectable()
export class SignIn {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SessionTokens,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    email: string;
    password: string;
  }): Promise<SignInResult> {
    const user = await this.users.findByEmail(normalizeEmail(input.email));
    // Always verify, even without an account, so the time taken does not tell whether the email exists.
    const matches = await this.hasher.verify(
      input.password,
      user?.passwordHash ?? null,
    );
    if (user === null || !matches) {
      await this.recordFailure(user);
      return { outcome: 'INVALID_CREDENTIALS' };
    }
    if (!user.canSignIn) {
      await this.recordFailure(user);
      return { outcome: 'ACCOUNT_DISABLED' };
    }

    const now = this.clock.now();
    const sessionId = newId<'Session'>();
    const refresh = this.tokens.newRefreshToken(user.id, sessionId, now);
    await this.transactions.run(async () => {
      await this.sessions.add(refresh.record);
      await this.users.recordSignIn(user.id, now);
      await this.audit.record({
        action: 'auth.login',
        actor: { type: 'USER', id: user.id },
        resource: { type: 'user', id: user.id },
      });
    });
    return {
      outcome: 'AUTHENTICATED',
      userId: user.id,
      mustChangePassword: user.mustChangePassword,
      tokens: this.tokens.pair(user.id, sessionId, refresh.token),
    };
  }

  private recordFailure(user: User | null): Promise<void> {
    return this.audit.recordIndependently({
      action: 'auth.login',
      result: 'DENIED',
      actor: { type: 'ANONYMOUS' },
      ...(user === null ? {} : { resource: { type: 'user', id: user.id } }),
    });
  }
}
