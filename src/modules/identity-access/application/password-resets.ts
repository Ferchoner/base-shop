import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EmailSender,
  emailSafeText,
  FrontendLinks,
  lifetimeInWords,
  newId,
  newLinkToken,
} from '../../../shared-kernel/index.js';
import { PasswordResetTokenRepository } from '../domain/password-reset.js';
import type { UserId } from '../domain/user.js';

/** Seconds a recovery link lives (`PASSWORD_RESET_TTL`, BR-USR-16). */
export const PASSWORD_RESET_TTL_SECONDS = Symbol('PASSWORD_RESET_TTL_SECONDS');

/** Frontend page that reads the token and sends it with the new password (ADR-0117, ADR-0118). */
export const RESET_PASSWORD_PAGE = '/reset-password';

/**
 * Password recovery links (ADR-0056, ADR-0118): issuing one inside a transaction, invalidating the pending
 * ones, and sending it after the commit.
 */
@Injectable()
export class PasswordResets {
  private readonly logger = new Logger(PasswordResets.name);

  constructor(
    private readonly tokens: PasswordResetTokenRepository,
    private readonly links: FrontendLinks,
    private readonly email: EmailSender,
    @Inject(PASSWORD_RESET_TTL_SECONDS)
    private readonly ttlSeconds: number,
  ) {}

  /** Stores a new link, replacing the earlier ones, and returns its token to send. */
  async issue(userId: UserId, now: Date): Promise<string> {
    await this.invalidatePendingOf(userId, now);
    const { token, hash } = newLinkToken();
    await this.tokens.add({
      id: newId(),
      userId,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    });
    return token;
  }

  /** Invalidates the pending links, as a change of email does: they went to the previous address. */
  invalidatePendingOf(userId: UserId, now: Date): Promise<void> {
    return this.tokens.invalidatePendingOf(userId, now);
  }

  /**
   * Sends the link, after the commit. A failure stays in the log, without the address, and is not retried
   * (ADR-0110): the person can ask for another link.
   */
  async send(
    account: { id: string; email: string; firstNames: string },
    token: string,
  ): Promise<void> {
    try {
      await this.email.send({
        to: account.email,
        subject: 'Restablece tu contraseña',
        text: [
          `Hola, ${emailSafeText(account.firstNames)}:`,
          '',
          'Para elegir una contraseña nueva, abre este enlace:',
          this.links.link(RESET_PASSWORD_PAGE, { token }),
          '',
          `El enlace vence en ${lifetimeInWords(this.ttlSeconds)} y sirve una sola vez. Si pides otro, este deja de funcionar.`,
          '',
          'Si no lo pediste, ignora este mensaje: tu contraseña no cambia.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.warn(
        `Password reset email for user ${account.id} was not sent: ${(error as Error).message}`,
      );
    }
  }
}
