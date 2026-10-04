import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
} from '../../shared-kernel/index.js';
import type { EnvironmentVariables } from '../config/environment.js';

/** How long to wait for the mail server before giving up, so a slow server cannot hang the caller. */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

/**
 * Sends emails through SMTP with nodemailer (ADR-0110): to Mailpit in development (ADR-0045), to the real
 * provider once P-24 is decided, which also decides its authentication. In production the connection is always
 * encrypted, with a verified certificate, since the links carry tokens (T-310, ADR-0154). nodemailer encodes UTF-8
 * subjects and bodies and strips line breaks from headers, so a subject cannot inject other headers.
 *
 * The log never shows the recipient or the content (ADR-0097): only the message id, or the SMTP error code.
 */
@Injectable()
export class SmtpEmailSender extends EmailSender implements OnModuleDestroy {
  private readonly logger = new Logger('Email');
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    const port = config.get('SMTP_PORT', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port,
      // Port 465 is TLS from the start. On other ports nodemailer upgrades with STARTTLS: in production it must, or
      // the email is not sent; Mailpit, in development, offers none.
      secure: port === 465,
      requireTLS: config.get('NODE_ENV', { infer: true }) === 'production',
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      const info = (await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })) as { messageId: string };
      this.logger.log(`Email sent: ${info.messageId}`);
    } catch (error) {
      // Only the code: SMTP error messages may quote the recipient.
      const code = smtpErrorCode(error);
      this.logger.warn(`Email not sent: ${code}`);
      throw new EmailDeliveryError(
        `The mail server did not take the email (${code})`,
      );
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}

function smtpErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown error';
  const { code, responseCode } = error as {
    code?: unknown;
    responseCode?: unknown;
  };
  return (
    [code, responseCode]
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .join(' ') || 'unknown error'
  );
}
