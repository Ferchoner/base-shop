import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  NotFoundError,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { PasswordPolicyViolationError } from '../domain/password.js';
import type { SessionId } from '../domain/session.js';
import { SessionRepository } from '../domain/session.repository.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { PasswordChangeNotice } from './password-change-notice.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordPolicy } from './password-policy.js';

export type ChangePasswordResult =
  | { readonly outcome: 'CHANGED' }
  | { readonly outcome: 'INVALID_CURRENT_PASSWORD' };

/**
 * Changes the signed-in user's password (UC-IAM-09, BR-USR-10, BR-USR-19). The current password is required;
 * for staff with a temporary password, that is the temporary one (BR-USR-17). The new one follows the policy
 * and differs from the current one. The other sessions are revoked and the one of the request is kept
 * (ADR-0072); the change is audited and the owner is told by email after the commit.
 */
@Injectable()
export class ChangePassword {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly notice: PasswordChangeNotice,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: UserId;
    sessionId: SessionId;
    currentPassword: string;
    newPassword: string;
  }): Promise<ChangePasswordResult> {
    const changed = await this.transactions.run(async () => {
      const user = await this.users.findById(input.userId);
      if (user === null) throw new NotFoundError('User', input.userId);
      const currentHash = user.passwordHash;
      if (!(await this.hasher.verify(input.currentPassword, currentHash))) {
        return null;
      }
      this.policy.assertAcceptable(input.newPassword, 'newPassword');
      if (await this.hasher.verify(input.newPassword, currentHash)) {
        throw new PasswordPolicyViolationError('samePassword', 'newPassword');
      }

      const now = this.clock.now();
      const pendingChange = user.mustChangePassword;
      user.changePassword(await this.hasher.hash(input.newPassword), now);
      await this.users.save(user, user.id);
      await this.sessions.revokeAllOf(user.id, now, input.sessionId);
      await this.audit.record({
        action: 'auth.password-change',
        resource: { type: 'user', id: user.id },
        changes: changesBetween(
          { passwordHash: currentHash, mustChangePassword: pendingChange },
          {
            passwordHash: user.passwordHash,
            mustChangePassword: user.mustChangePassword,
          },
        ),
      });
      const { email, firstNames } = user.snapshot();
      return { email, firstNames, at: now };
    });

    if (changed === null) {
      await this.audit.recordIndependently({
        action: 'auth.password-change',
        result: 'DENIED',
        resource: { type: 'user', id: input.userId },
      });
      return { outcome: 'INVALID_CURRENT_PASSWORD' };
    }
    // An account that can sign in always has an email and names (CHECK on users, DATABASE.md §3.1).
    await this.notice.send(
      {
        id: input.userId,
        email: changed.email as string,
        firstNames: changed.firstNames as string,
      },
      changed.at,
    );
    return { outcome: 'CHANGED' };
  }
}
