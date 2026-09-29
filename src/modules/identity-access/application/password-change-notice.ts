import { Injectable, Logger } from '@nestjs/common';
import { EmailSender } from '../../../shared-kernel/index.js';

/** The time of the change as people in Mexico read it, like the store's schedules (ADR-0101). */
const WHEN = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});

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
          `Hola, ${account.firstNames}:`,
          '',
          `La contraseña de tu cuenta se cambió el ${WHEN.format(changedAt)} (hora del centro de México).`,
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
