import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EmailSender,
  FrontendLinks,
  lifetimeInWords,
  newId,
  newLinkToken,
} from '../../../shared-kernel/index.js';
import { EmailVerificationTokenRepository } from '../domain/email-verification.js';
import type { UserId } from '../domain/user.js';

/** Seconds a verification link lives (`EMAIL_VERIFICATION_TTL`, BR-USR-11). */
export const EMAIL_VERIFICATION_TTL_SECONDS = Symbol(
  'EMAIL_VERIFICATION_TTL_SECONDS',
);

/** Frontend page that reads the token and confirms it with the API (ADR-0056, ADR-0117). */
export const VERIFY_EMAIL_PAGE = '/verify-email';

/**
 * Email verification links (ADR-0046, ADR-0117): issuing one inside the transaction that needs it, and
 * sending it after the commit. A new link invalidates the earlier ones.
 */
@Injectable()
export class EmailVerifications {
  private readonly logger = new Logger(EmailVerifications.name);

  constructor(
    private readonly tokens: EmailVerificationTokenRepository,
    private readonly links: FrontendLinks,
    private readonly email: EmailSender,
    @Inject(EMAIL_VERIFICATION_TTL_SECONDS)
    private readonly ttlSeconds: number,
  ) {}

  /** Stores a new link for the address, replacing the earlier ones, and returns its token to send. */
  async issue(userId: UserId, address: string, now: Date): Promise<string> {
    await this.tokens.invalidatePendingOf(userId, now);
    const { token, hash } = newLinkToken();
    await this.tokens.add({
      id: newId(),
      userId,
      email: address,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    });
    return token;
  }

  /**
   * Sends the link, after the commit. A failure stays in the log, without the address, and is not retried
   * (ADR-0110): the customer can ask for another link.
   */
  async send(
    account: { id: string; email: string; firstNames: string },
    token: string,
  ): Promise<void> {
    try {
      await this.email.send({
        to: account.email,
        subject: 'Confirma tu correo',
        text: [
          `Hola, ${account.firstNames}:`,
          '',
          'Confirma tu correo en este enlace:',
          this.links.link(VERIFY_EMAIL_PAGE, { token }),
          '',
          `El enlace vence en ${lifetimeInWords(this.ttlSeconds)} y sirve una sola vez. Si pides otro, este deja de funcionar.`,
          '',
          'Si no creaste una cuenta ni cambiaste tu correo, ignora este mensaje.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.warn(
        `Verification email for user ${account.id} was not sent: ${(error as Error).message}`,
      );
    }
  }
}
