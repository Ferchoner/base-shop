import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
  FrontendLinks,
} from '../../../shared-kernel/index.js';
import type { EmailVerificationTokenRepository } from '../domain/email-verification.js';
import { EmailVerifications } from './email-verifications.js';

class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];
  failure?: Error;

  send(message: EmailMessage): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve();
  }
}

class ShopLinks extends FrontendLinks {
  link(path: string, params: Readonly<Record<string, string>> = {}): string {
    return `https://shop.example.com${path}?${new URLSearchParams(params)}`;
  }
}

const ACCOUNT = {
  id: '01a0ea00-0000-7000-8000-000000000001',
  email: 'maria@example.com',
  firstNames: 'María',
};
const UNUSED_TOKENS = {} as EmailVerificationTokenRepository;

/** A name with a line break and a link, as anyone can type it when signing up with someone else's email. */
const TYPED_NAME = ['Ana', 'Visita https://tienda-falsa.com'].join(
  String.fromCharCode(13, 10),
);

describe('EmailVerifications.send (ADR-0046, ADR-0117)', () => {
  it('sends the link to the verification page of the frontend, with its lifetime', async () => {
    const email = new RecordingEmailSender();

    await new EmailVerifications(
      UNUSED_TOKENS,
      new ShopLinks(),
      email,
      86_400,
    ).send(ACCOUNT, 'token-123');

    expect(email.sent).toEqual([
      {
        to: 'maria@example.com',
        subject: 'Confirma tu correo',
        text: expect.stringContaining('Hola, María:'),
      },
    ]);
    const { text } = email.sent[0];
    expect(text).toContain(
      'https://shop.example.com/verify-email?token=token-123',
    );
    expect(text).toContain('El enlace vence en 24 horas y sirve una sola vez.');
    expect(text).toContain('Si no creaste una cuenta ni cambiaste tu correo');
  });

  it.each([
    [3_600, '1 hora'],
    [7 * 86_400, '168 horas'],
    [5_400, '90 minutos'],
  ])('says a lifetime of %i seconds as %s', async (seconds, words) => {
    const email = new RecordingEmailSender();

    await new EmailVerifications(
      UNUSED_TOKENS,
      new ShopLinks(),
      email,
      seconds,
    ).send(ACCOUNT, 'token-123');

    expect(email.sent[0].text).toContain(`vence en ${words} y`);
  });

  it('logs a failed email without the address, and never fails the caller', async () => {
    const email = new RecordingEmailSender();
    email.failure = new EmailDeliveryError('SMTP 421');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await new EmailVerifications(
      UNUSED_TOKENS,
      new ShopLinks(),
      email,
      86_400,
    ).send(ACCOUNT, 'token-123');
    const logged = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();

    expect(logged).toEqual([
      `Verification email for user ${ACCOUNT.id} was not sent: SMTP 421`,
    ]);
  });

  it('quotes the name on one line and without links (ADR-0154)', async () => {
    const email = new RecordingEmailSender();

    await new EmailVerifications(
      UNUSED_TOKENS,
      new ShopLinks(),
      email,
      86_400,
    ).send({ ...ACCOUNT, firstNames: TYPED_NAME }, 'token-123');

    const { text } = email.sent[0];
    expect(text).toContain('Hola, Ana Visita https: //tienda-falsa. com:');
    expect(text).not.toContain('tienda-falsa.com');
  });
});
