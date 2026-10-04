import { Injectable, Logger } from '@nestjs/common';
import {
  EmailSender,
  emailSafeText,
  inMexicoTime,
} from '../../../shared-kernel/index.js';

/**
 * Tells the account owner that their password changed (ADR-0056, ADR-0072, ADR-0115), so someone who did
 * not change it can react. Sent after the change is committed; a failure stays in the log and is not
 * retried (ADR-0110), since the change already happened.
 */
@Injectable()
export class PasswordChangeNotice {
  private readonly logger = new Logger(PasswordChangeNotice.name);

  constructor(private readonly email: EmailSender) {}

  async send(
    account: { id: string; email: string; firstNames: string },
    changedAt: Date,
  ): Promise<void> {
    try {
      await this.email.send({
        to: account.email,
        subject: 'Tu contraseña cambió',
        text: [
          `Hola, ${emailSafeText(account.firstNames)}:`,
          '',
          `La contraseña de tu cuenta se cambió el ${inMexicoTime(changedAt)} (hora del centro de México).`,
          '',
          'Si fuiste tú, no tienes que hacer nada.',
          '',
          'Si no fuiste tú, recupera tu cuenta con la opción "Olvidé mi contraseña" y contacta a la tienda.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.warn(
        `Password change notice for user ${account.id} was not sent: ${(error as Error).message}`,
      );
    }
  }
}
