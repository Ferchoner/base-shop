import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
  type Frontend,
  FrontendLinks,
} from '../../../shared-kernel/index.js';
import type { PasswordResetTokenRepository } from '../domain/password-reset.js';
import { PasswordResets } from './password-resets.js';

class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];
  failure?: Error;

  send(message: EmailMessage): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve();
  }
}

class TwoFrontendLinks extends FrontendLinks {
  link(
    frontend: Frontend,
    path: string,
    params: Readonly<Record<string, string>> = {},
  ): string {
    const host = frontend === 'shop' ? 'shop' : 'admin';
    return `https://${host}.example.com${path}?${new URLSearchParams(params)}`;
  }
}

const ACCOUNT = {
  id: '01a0ea00-0000-7000-8000-000000000001',
  email: 'maria@example.com',
  firstNames: 'María',
  type: 'CUSTOMER' as const,
};
const UNUSED_TOKENS = {} as PasswordResetTokenRepository;

/** A name with a line break and a link, as anyone can type it when signing up with someone else's email. */
const TYPED_NAME = ['Ana', 'Visita https://tienda-falsa.com'].join(
  String.fromCharCode(13, 10),
);

describe('PasswordResets.send (ADR-0056, ADR-0118, ADR-0169)', () => {
  it('sends a customer the link to the reset page of the shop, with its lifetime', async () => {
    const email = new RecordingEmailSender();

    await new PasswordResets(
      UNUSED_TOKENS,
      new TwoFrontendLinks(),
      email,
      1_800,
    ).send(ACCOUNT, 'token-123');

    expect(email.sent).toEqual([
      {
        to: 'maria@example.com',
        subject: 'Restablece tu contraseña',
        text: expect.stringContaining('Hola, María:'),
      },
    ]);
    const { text } = email.sent[0];
    expect(text).toContain(
      'https://shop.example.com/reset-password?token=token-123',
    );
    expect(text).toContain(
      'El enlace vence en 30 minutos y sirve una sola vez.',
    );
    expect(text).toContain(
      'Si no lo pediste, ignora este mensaje: tu contraseña no cambia.',
    );
  });

  it('sends the staff the link to the reset page of the backoffice', async () => {
    const email = new RecordingEmailSender();

    await new PasswordResets(
      UNUSED_TOKENS,
      new TwoFrontendLinks(),
      email,
      1_800,
    ).send({ ...ACCOUNT, type: 'STAFF' }, 'token-123');

    const { text } = email.sent[0];
    expect(text).toContain(
      'https://admin.example.com/reset-password?token=token-123',
    );
    expect(text).not.toContain('shop.example.com');
  });

  it('logs a failed email without the address, and never fails the caller', async () => {
    const email = new RecordingEmailSender();
    email.failure = new EmailDeliveryError('SMTP 421');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await new PasswordResets(
      UNUSED_TOKENS,
      new TwoFrontendLinks(),
      email,
      1_800,
    ).send(ACCOUNT, 'token-123');
    const logged = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();

    expect(logged).toEqual([
      `Password reset email for user ${ACCOUNT.id} was not sent: SMTP 421`,
    ]);
  });

  it('quotes the name on one line and without links (ADR-0154)', async () => {
    const email = new RecordingEmailSender();

    await new PasswordResets(
      UNUSED_TOKENS,
      new TwoFrontendLinks(),
      email,
      1_800,
    ).send({ ...ACCOUNT, firstNames: TYPED_NAME }, 'token-123');

    const { text } = email.sent[0];
    expect(text).toContain('Hola, Ana Visita https: //tienda-falsa. com:');
    expect(text).not.toContain('tienda-falsa.com');
  });
});
