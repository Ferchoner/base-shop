import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
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
const UNUSED_TOKENS = {} as PasswordResetTokenRepository;

describe('PasswordResets.send (ADR-0056, ADR-0118)', () => {
  it('sends the link to the reset page of the frontend, with its lifetime', async () => {
    const email = new RecordingEmailSender();

    await new PasswordResets(UNUSED_TOKENS, new ShopLinks(), email, 1_800).send(
      ACCOUNT,
      'token-123',
    );

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

  it('logs a failed email without the address, and never fails the caller', async () => {
    const email = new RecordingEmailSender();
    email.failure = new EmailDeliveryError('SMTP 421');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await new PasswordResets(UNUSED_TOKENS, new ShopLinks(), email, 1_800).send(
      ACCOUNT,
      'token-123',
    );
    const logged = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();

    expect(logged).toEqual([
      `Password reset email for user ${ACCOUNT.id} was not sent: SMTP 421`,
    ]);
  });
});
