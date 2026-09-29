import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  Clock,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { UserId } from '../domain/user.js';
import { UserRepository } from '../domain/user.repository.js';
import { EmailChangeNotice } from './email-change-notice.js';
import { EmailVerifications } from './email-verifications.js';
import { PasswordHasher } from './password-hasher.js';
import { findUserOfType } from './user-support.js';

export type ChangeEmailResult =
  | { readonly outcome: 'CHANGED' }
  | { readonly outcome: 'INVALID_CURRENT_PASSWORD' };

/**
 * A customer changes their email (UC-IAM-10, BR-USR-11): the current password is required, the new email
 * must be free and stays unverified, so they cannot buy until they verify it. Links sent to the previous
 * address stop working. After the commit, the new address gets its link and the previous one a notice
 * (ADR-0117). Audited as a security event, without the addresses.
 */
@Injectable()
export class ChangeEmail {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly verifications: EmailVerifications,
    private readonly notice: EmailChangeNotice,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: UserId;
    newEmail: string;
    currentPassword: string;
  }): Promise<ChangeEmailResult> {
    const changed = await this.transactions.run(async () => {
      const user = await findUserOfType(this.users, input.userId, 'CUSTOMER');
      if (
        !(await this.hasher.verify(input.currentPassword, user.passwordHash))
      ) {
        return null;
      }
      const previous = user.snapshot();
      user.changeEmail(input.newEmail);
      await this.users.save(user, user.id);
      const now = this.clock.now();
      const address = user.email as string;
      const token = await this.verifications.issue(user.id, address, now);
      await this.audit.record({
        action: 'auth.email-change',
        resource: { type: 'user', id: user.id },
        changes: changesBetween({ email: previous.email }, { email: address }),
      });
      return {
        previousEmail: previous.email as string,
        email: address,
        firstNames: previous.firstNames as string,
        token,
        at: now,
      };
    });

    if (changed === null) {
      await this.audit.recordIndependently({
        action: 'auth.email-change',
        result: 'DENIED',
        resource: { type: 'user', id: input.userId },
      });
      return { outcome: 'INVALID_CURRENT_PASSWORD' };
    }
    const account = { id: input.userId, firstNames: changed.firstNames };
    await this.verifications.send(
      { ...account, email: changed.email },
      changed.token,
    );
    await this.notice.send(
      { ...account, previousEmail: changed.previousEmail },
      changed.at,
    );
    return { outcome: 'CHANGED' };
  }
}
