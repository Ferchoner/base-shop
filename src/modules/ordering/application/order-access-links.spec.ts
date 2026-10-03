import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import {
  type DomainEvent,
  type DomainEventPublisher,
  type EmailMessage,
  type EmailSender,
  EmailDeliveryError,
  type FrontendLinks,
  hashLinkToken,
  InvalidOrExpiredTokenError,
  type TransactionManager,
} from '../../../shared-kernel/index.js';
import {
  type OrderAccessToken,
  type OrderAccessTokenId,
  OrderAccessTokenRepository,
} from '../domain/order-access-token.js';
import { MAX_ACCESS_ORDERS, OrderAccessLinks } from './order-access-links.js';
import type { OrderReader } from './order-reader.js';
import type { OrderingQueries } from './ordering.queries.js';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const EMAIL = 'cliente@example.com';
const ORDERS = [{ publicCode: 'K7M4Q9XA' }, { publicCode: 'H3N8P2WB' }];

/** Stored links in memory; every call goes to `calls`, in order, with the commit of the transaction. */
class Links extends OrderAccessTokenRepository {
  readonly rows: OrderAccessToken[] = [];

  constructor(private readonly calls: string[]) {
    super();
  }

  lockEmail(contactEmail: string): Promise<void> {
    this.calls.push(`lock ${contactEmail}`);
    return Promise.resolve();
  }

  add(
    token: Omit<OrderAccessToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void> {
    this.calls.push(`add ${token.contactEmail}`);
    this.rows.push({ ...token, usedAt: null, invalidatedAt: null });
    return Promise.resolve();
  }

  findByHashForUpdate(tokenHash: string): Promise<OrderAccessToken | null> {
    this.calls.push('find');
    return Promise.resolve(
      this.rows.find((row) => row.tokenHash === tokenHash) ?? null,
    );
  }

  markUsed(id: OrderAccessTokenId, at: Date): Promise<void> {
    this.calls.push('markUsed');
    this.update(id, { usedAt: at });
    return Promise.resolve();
  }

  invalidatePendingOf(contactEmail: string, at: Date): Promise<void> {
    this.calls.push(`invalidate ${contactEmail} ${at.toISOString()}`);
    return Promise.resolve();
  }

  deleteOf(): Promise<void> {
    throw new Error('Only the anonymization deletes links');
  }

  /** Stores a link of `EMAIL` for the token `token`, changed as given. */
  stored(token: string, changes: Partial<OrderAccessToken> = {}): void {
    this.rows.push({
      id: `link-${this.rows.length}` as OrderAccessTokenId,
      contactEmail: EMAIL,
      tokenHash: hashLinkToken(token),
      expiresAt: new Date(NOW.getTime() + 60_000),
      usedAt: null,
      invalidatedAt: null,
      ...changes,
    });
  }

  private update(id: OrderAccessTokenId, changes: Partial<OrderAccessToken>) {
    const index = this.rows.findIndex((row) => row.id === id);
    this.rows[index] = { ...this.rows[index], ...changes };
  }
}

function setUp(options: { hasOrders?: boolean; emailFails?: boolean } = {}) {
  const calls: string[] = [];
  const links = new Links(calls);
  const queries = {
    hasGuestOrders: (contactEmail: string) => {
      calls.push(`hasGuestOrders ${contactEmail}`);
      return Promise.resolve(options.hasOrders ?? true);
    },
  } as unknown as OrderingQueries;
  const reader = {
    guestOrders: (contactEmail: string, limit: number) => {
      calls.push(`guestOrders ${contactEmail} ${limit}`);
      return Promise.resolve(ORDERS);
    },
  } as unknown as OrderReader;
  const frontend = {
    link: (path: string, params: Record<string, string>) =>
      `https://tienda.example.com${path}?token=${params.token}`,
  } as FrontendLinks;
  const sent: EmailMessage[] = [];
  const email = {
    send: (message: EmailMessage) => {
      calls.push(`send ${message.to}`);
      if (options.emailFails) {
        return Promise.reject(new EmailDeliveryError('Connection refused'));
      }
      sent.push(message);
      return Promise.resolve();
    },
  } as EmailSender;
  const published: DomainEvent[] = [];
  const events = {
    publish: (...batch: DomainEvent[]) => published.push(...batch),
  } as DomainEventPublisher;
  const transactions = {
    run: async <T>(work: () => Promise<T>) => {
      const result = await work();
      calls.push('commit');
      return result;
    },
  } as unknown as TransactionManager;
  const accessLinks = new OrderAccessLinks(
    links,
    queries,
    reader,
    frontend,
    email,
    events,
    transactions,
    { now: () => NOW },
    1_800,
  );
  return { accessLinks, links, calls, sent, published };
}

/** The token of the link in the last email sent. */
function tokenOf(message: EmailMessage | undefined): string {
  const token = /order-access\?token=([\w-]+)/.exec(message?.text ?? '');
  if (token === null) throw new Error('No access link was sent');
  return token[1];
}

describe('OrderAccessLinks (UC-ORD-05, ADR-0148)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('request', () => {
    it('only publishes OrderAccessRequested with the email normalized, so the link goes out in the background', () => {
      const { accessLinks, calls, published } = setUp();

      accessLinks.request('  Cliente@Example.COM ');

      expect(published).toEqual([
        {
          eventId: expect.any(String),
          eventType: 'OrderAccessRequested',
          occurredAt: NOW,
          contactEmail: EMAIL,
        },
      ]);
      expect(calls).toEqual([]);
    });
  });

  describe('issue', () => {
    it('replaces the pending links of an email with guest orders by a new one, and sends it after the commit', async () => {
      const { accessLinks, links, calls, sent } = setUp();

      await accessLinks.issue(EMAIL);

      expect(calls).toEqual([
        `lock ${EMAIL}`,
        `hasGuestOrders ${EMAIL}`,
        `invalidate ${EMAIL} ${NOW.toISOString()}`,
        `add ${EMAIL}`,
        'commit',
        `send ${EMAIL}`,
      ]);
      const token = tokenOf(sent[0]);
      expect(links.rows).toEqual([
        {
          id: expect.any(String),
          contactEmail: EMAIL,
          tokenHash: hashLinkToken(token),
          expiresAt: new Date('2026-10-03T12:30:00.000Z'),
          usedAt: null,
          invalidatedAt: null,
        },
      ]);
      expect(sent).toEqual([
        {
          to: EMAIL,
          subject: 'Consulta tus pedidos',
          text: [
            'Hola:',
            '',
            'Para ver los pedidos que hiciste como invitado con este correo, abre este enlace:',
            `https://tienda.example.com/order-access?token=${token}`,
            '',
            'El enlace vence en 30 minutos y sirve una sola vez. Si pides otro, este deja de funcionar.',
            '',
            'Si no lo pediste, ignora este mensaje.',
          ].join('\n'),
        },
      ]);
    });

    it('stores and sends nothing for an email without guest orders', async () => {
      const { accessLinks, links, calls } = setUp({ hasOrders: false });

      await accessLinks.issue(EMAIL);

      expect(calls).toEqual([
        `lock ${EMAIL}`,
        `hasGuestOrders ${EMAIL}`,
        'commit',
      ]);
      expect(links.rows).toEqual([]);
    });

    it('keeps the link when the email fails, and logs it without the address', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const { accessLinks, links } = setUp({ emailFails: true });

      await expect(accessLinks.issue(EMAIL)).resolves.toBeUndefined();

      expect(links.rows).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        'Order access email was not sent: Connection refused',
      );
    });
  });

  describe('redeem', () => {
    it('uses the link once and answers the newest guest orders of its email, read in the same transaction', async () => {
      const { accessLinks, links, calls } = setUp();
      links.stored('el-token');

      expect(await accessLinks.redeem('el-token')).toEqual({
        contactEmail: EMAIL,
        orders: ORDERS,
      });
      expect(calls).toEqual([
        'find',
        'markUsed',
        `guestOrders ${EMAIL} ${MAX_ACCESS_ORDERS}`,
        'commit',
      ]);
      expect(links.rows[0].usedAt).toBe(NOW);
      expect(MAX_ACCESS_ORDERS).toBe(50);
    });

    it.each([
      ['does not exist', 'otro-token', {}],
      ['was used', 'el-token', { usedAt: NOW }],
      ['was replaced', 'el-token', { invalidatedAt: NOW }],
      ['expired at this instant', 'el-token', { expiresAt: NOW }],
    ])(
      'answers invalid-or-expired-token for a link that %s, reading no order (E-20)',
      async (_, token, changes) => {
        const { accessLinks, links, calls } = setUp();
        links.stored('el-token', changes);

        await expect(accessLinks.redeem(token)).rejects.toThrow(
          InvalidOrExpiredTokenError,
        );
        expect(calls).toEqual(['find']);
      },
    );
  });
});
