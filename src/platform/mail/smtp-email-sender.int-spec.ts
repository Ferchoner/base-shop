import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { EmailDeliveryError } from '../../shared-kernel/index.js';
import type { EnvironmentVariables } from '../config/environment.js';
import { SmtpEmailSender } from './smtp-email-sender.js';

/** Same local catcher as docker compose (ADR-0045). */
const MAILPIT_IMAGE = 'axllent/mailpit:v1';
const RECIPIENT = 'cliente@example.com';

interface MailpitMessage {
  From: { Name: string; Address: string };
  To: { Address: string }[];
  Bcc: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

function senderFor(host: string, port: number): SmtpEmailSender {
  const values: Partial<EnvironmentVariables> = {
    SMTP_HOST: host,
    SMTP_PORT: port,
    MAIL_FROM: 'Tienda Base <no-reply@base-shop.test>',
  };
  const config = {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new SmtpEmailSender(config);
}

/** Email sending through real SMTP, into a Mailpit container (T-122, ADR-0110). */
describe('SmtpEmailSender (T-122)', () => {
  let mailpit: StartedTestContainer;
  let sender: SmtpEmailSender;
  let api: string;

  beforeAll(async () => {
    mailpit = await new GenericContainer(MAILPIT_IMAGE)
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start();
    sender = senderFor(mailpit.getHost(), mailpit.getMappedPort(1025));
    api = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`;
  }, 120_000);

  afterAll(async () => {
    sender.onModuleDestroy();
    await mailpit.stop();
  });

  beforeEach(async () => {
    await fetch(`${api}/messages`, { method: 'DELETE' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The only message in the inbox, as Mailpit parsed it. */
  async function receivedMessage(): Promise<MailpitMessage> {
    const list = (await (await fetch(`${api}/messages`)).json()) as {
      messages: { ID: string }[];
    };
    expect(list.messages).toHaveLength(1);
    const response = await fetch(`${api}/message/${list.messages[0].ID}`);
    return (await response.json()) as MailpitMessage;
  }

  it('delivers the text and HTML versions with the configured sender and UTF-8 accents', async () => {
    await sender.send({
      to: RECIPIENT,
      subject: 'Confirma tu correo — Café Ñandú',
      text: 'Hola, confirma tu dirección: https://shop.example.com/verify?token=abc',
      html: '<p>Hola, <strong>confirma</strong> tu dirección.</p>',
    });

    const message = await receivedMessage();
    expect(message.From).toEqual({
      Name: 'Tienda Base',
      Address: 'no-reply@base-shop.test',
    });
    expect(message.To.map((to) => to.Address)).toEqual([RECIPIENT]);
    expect(message.Subject).toBe('Confirma tu correo — Café Ñandú');
    expect(message.Text.trim()).toBe(
      'Hola, confirma tu dirección: https://shop.example.com/verify?token=abc',
    );
    expect(message.HTML).toContain('<strong>confirma</strong> tu dirección');
  });

  it('does not let a subject with line breaks add headers', async () => {
    await sender.send({
      to: RECIPIENT,
      subject: 'Pedido listo\r\nBcc: attacker@example.com',
      text: 'Texto',
    });

    const message = await receivedMessage();
    expect(message.Bcc).toEqual([]);
    expect(message.To.map((to) => to.Address)).toEqual([RECIPIENT]);
  });

  it('logs the message id but never the recipient', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    await sender.send({ to: RECIPIENT, subject: 'Hola', text: 'Texto' });

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([expect.stringMatching(/^Email sent: <.+>$/)]);
    expect(lines.join('\n')).not.toContain(RECIPIENT);
  });

  it('rejects with EmailDeliveryError when the server cannot be reached, without the recipient in the log', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    // A port where nothing listens: the connection is refused at once.
    const unreachable = senderFor('127.0.0.1', 1);

    const sending = unreachable.send({
      to: RECIPIENT,
      subject: 'Hola',
      text: 'Texto',
    });

    await expect(sending).rejects.toThrow(EmailDeliveryError);
    await expect(sending).rejects.not.toThrow(RECIPIENT);
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([expect.stringMatching(/^Email not sent: /)]);
    expect(lines.join('\n')).not.toContain(RECIPIENT);
    unreachable.onModuleDestroy();
  });
});
