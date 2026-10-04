import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
} from '../../../shared-kernel/index.js';
import { PasswordChangeNotice } from './password-change-notice.js';

class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];
  failure?: Error;

  send(message: EmailMessage): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve();
  }
}

const ACCOUNT = {
  id: '01a0ea00-0000-7000-8000-000000000001',
  email: 'ana.perez@example.com',
  firstNames: 'Ana',
};
/** 16:05 UTC is 10:05 in central Mexico. */
const CHANGED_AT = new Date('2026-09-29T16:05:00Z');

/** A name with a line break and a link, as anyone can type it when signing up with someone else's email. */
const TYPED_NAME = ['Ana', 'Visita https://tienda-falsa.com'].join(
  String.fromCharCode(13, 10),
);

describe('PasswordChangeNotice (ADR-0072, ADR-0115)', () => {
  it('tells the owner when their password changed, in Mexico time, and what to do if it was not them', async () => {
    const email = new RecordingEmailSender();

    await new PasswordChangeNotice(email).send(ACCOUNT, CHANGED_AT);

    expect(email.sent).toEqual([
      {
        to: 'ana.perez@example.com',
        subject: 'Tu contraseña cambió',
        text: expect.stringContaining('Hola, Ana:'),
      },
    ]);
    const { text } = email.sent[0];
    expect(text).toContain(
      'se cambió el 29 de septiembre de 2026 a las 10:05 a.m. (hora del centro de México).',
    );
    expect(text).toContain('Si fuiste tú, no tienes que hacer nada.');
    expect(text).toContain('"Olvidé mi contraseña"');
  });

  it('never fails the change when the email is not sent, and logs it without the address', async () => {
    const email = new RecordingEmailSender();
    email.failure = new EmailDeliveryError('SMTP 421');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      new PasswordChangeNotice(email).send(ACCOUNT, CHANGED_AT),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      `Password change notice for user ${ACCOUNT.id} was not sent: SMTP 421`,
    );
    expect(String(warn.mock.calls[0][0])).not.toContain(ACCOUNT.email);
    warn.mockRestore();
  });

  it('quotes the name on one line and without links (ADR-0154)', async () => {
    const email = new RecordingEmailSender();

    await new PasswordChangeNotice(email).send(
      { ...ACCOUNT, firstNames: TYPED_NAME },
      CHANGED_AT,
    );

    const { text } = email.sent[0];
    expect(text).toContain('Hola, Ana Visita https: //tienda-falsa. com:');
    expect(text).not.toContain('tienda-falsa.com');
  });
});
