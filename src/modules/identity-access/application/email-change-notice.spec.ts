import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
} from '../../../shared-kernel/index.js';
import { EmailChangeNotice } from './email-change-notice.js';

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
  previousEmail: 'anterior@example.com',
  firstNames: 'María',
};
/** 16:05 UTC is 10:05 in central Mexico. */
const CHANGED_AT = new Date('2026-09-29T16:05:00Z');

/** A name with a line break and a link, as anyone can type it when signing up with someone else's email. */
const TYPED_NAME = ['Ana', 'Visita https://tienda-falsa.com'].join(
  String.fromCharCode(13, 10),
);

describe('EmailChangeNotice (ADR-0117)', () => {
  it('tells the previous address when the email changed, without naming the new one', async () => {
    const email = new RecordingEmailSender();

    await new EmailChangeNotice(email).send(ACCOUNT, CHANGED_AT);

    expect(email.sent).toEqual([
      {
        to: 'anterior@example.com',
        subject: 'Tu correo cambió',
        text: expect.stringContaining('Hola, María:'),
      },
    ]);
    const { text } = email.sent[0];
    expect(text).toContain(
      'se cambió el 29 de septiembre de 2026 a las 10:05 a.m. (hora del centro de México)',
    );
    expect(text).toContain('Si no fuiste tú, contacta a la tienda.');
    expect(text).not.toMatch(/@/);
  });

  it('never fails the change when the notice is not sent', async () => {
    const email = new RecordingEmailSender();
    email.failure = new EmailDeliveryError('SMTP 421');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      new EmailChangeNotice(email).send(ACCOUNT, CHANGED_AT),
    ).resolves.toBeUndefined();
    const logged = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();

    expect(logged).toEqual([
      `Email change notice for user ${ACCOUNT.id} was not sent: SMTP 421`,
    ]);
  });

  it('quotes the name on one line and without links (ADR-0154)', async () => {
    const email = new RecordingEmailSender();

    await new EmailChangeNotice(email).send(
      { ...ACCOUNT, firstNames: TYPED_NAME },
      CHANGED_AT,
    );

    const { text } = email.sent[0];
    expect(text).toContain('Hola, Ana Visita https: //tienda-falsa. com:');
    expect(text).not.toContain('tienda-falsa.com');
  });
});
