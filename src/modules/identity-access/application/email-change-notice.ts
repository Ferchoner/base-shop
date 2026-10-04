import { Injectable, Logger } from '@nestjs/common';
import {
  EmailSender,
  emailSafeText,
  inMexicoTime,
} from '../../../shared-kernel/index.js';

/**
 * Tells the previous address that the account's email changed (ADR-0117), without naming the new one: if
 * someone else changed it, the owner finds out in the mailbox they still control. Sent after the commit; a
 * failure stays in the log and is not retried (ADR-0110).
 */
@Injectable()
export class EmailChangeNotice {
  private readonly logger = new Logger(EmailChangeNotice.name);

  constructor(private readonly email: EmailSender) {}

  async send(
    account: { id: string; previousEmail: string; firstNames: string },
    changedAt: Date,
  ): Promise<void> {
    try {
      await this.email.send({
        to: account.previousEmail,
        subject: 'Tu correo cambió',
        text: [
          `Hola, ${emailSafeText(account.firstNames)}:`,
          '',
          `El correo de tu cuenta se cambió el ${inMexicoTime(changedAt)} (hora del centro de México). Desde ahora, los avisos llegarán a la dirección nueva.`,
          '',
          'Si fuiste tú, no tienes que hacer nada.',
          '',
          'Si no fuiste tú, contacta a la tienda.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.warn(
        `Email change notice for user ${account.id} was not sent: ${(error as Error).message}`,
      );
    }
  }
}
