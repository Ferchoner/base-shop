import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  type DomainEvent,
  DomainEventPublisher,
  EmailSender,
  eventMetadata,
  FrontendLinks,
  hashLinkToken,
  InvalidOrExpiredTokenError,
  isUsableLink,
  lifetimeInWords,
  newId,
  newLinkToken,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import { OrderAccessTokenRepository } from '../domain/order-access-token.js';
import { normalizedContactEmail } from '../domain/order.js';
import { OrderReader, type WithPaymentAndShipment } from './order-reader.js';
import { OrderingQueries, type OrderSummaryView } from './ordering.queries.js';

/** Seconds an access link lives (`ORDER_ACCESS_LINK_TTL`, ADR-0148). */
export const ORDER_ACCESS_LINK_TTL_SECONDS = Symbol(
  'ORDER_ACCESS_LINK_TTL_SECONDS',
);

/** Frontend page that reads the token and sends it to the API (ADR-0117, ADR-0148). */
export const ORDER_ACCESS_PAGE = '/order-access';

/** Orders an access link shows at most, the newest: one answer, without pages, since the link works once. */
export const MAX_ACCESS_ORDERS = 50;

/**
 * Published when someone asks for an access link (UC-ORD-05), so the link is issued and sent in the background: the
 * answer, and how long it takes, never tell whether the email has orders (ADR-0148). It lives only in memory.
 */
export interface OrderAccessRequested extends DomainEvent<'OrderAccessRequested'> {
  /** Normalized. */
  readonly contactEmail: string;
}

/** What an access link opens: the guest orders of its email, newest first (UC-ORD-05). */
export interface OrderAccess {
  readonly contactEmail: string;
  readonly orders: readonly WithPaymentAndShipment<OrderSummaryView>[];
}

/**
 * The access links to the guest orders of an email (UC-ORD-05, ADR-0077, ADR-0148), for the guest who lost the code
 * of an order: asked with the email alone, issued and sent in the background only when the email has guest orders,
 * and used once within their lifetime. A new link replaces the pending ones of the email.
 */
@Injectable()
export class OrderAccessLinks {
  private readonly logger = new Logger(OrderAccessLinks.name);

  constructor(
    private readonly tokens: OrderAccessTokenRepository,
    private readonly queries: OrderingQueries,
    private readonly reader: OrderReader,
    private readonly links: FrontendLinks,
    private readonly email: EmailSender,
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    @Inject(ORDER_ACCESS_LINK_TTL_SECONDS)
    private readonly ttlSeconds: number,
  ) {}

  /** Accepts a request: the link is issued and sent in the background (`issue`), or nothing is sent. */
  request(contactEmail: string): void {
    const event: OrderAccessRequested = {
      ...eventMetadata('OrderAccessRequested', this.clock.now()),
      contactEmail: normalizedContactEmail(contactEmail),
    };
    this.events.publish(event);
  }

  /**
   * Issues a link for an email with guest orders, replacing the pending ones, and sends it after the commit. An email
   * without guest orders gets nothing.
   */
  async issue(contactEmail: string): Promise<void> {
    const token = await this.transactions.run(async () => {
      await this.tokens.lockEmail(contactEmail);
      if (!(await this.queries.hasGuestOrders(contactEmail))) return null;
      const now = this.clock.now();
      await this.tokens.invalidatePendingOf(contactEmail, now);
      const { token, hash } = newLinkToken();
      await this.tokens.add({
        id: newId(),
        contactEmail,
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
      });
      return token;
    });
    if (token !== null) await this.send(contactEmail, token);
  }

  /**
   * Uses a link: once, within its lifetime and while no newer one replaced it, it answers the guest orders of its
   * email. The orders are read in the same transaction, so a failure leaves the link usable.
   *
   * @throws InvalidOrExpiredTokenError when the link does not exist, was used, expired or was replaced (E-20).
   */
  redeem(token: string): Promise<OrderAccess> {
    return this.transactions.run(async () => {
      const link = await this.tokens.findByHashForUpdate(hashLinkToken(token));
      const now = this.clock.now();
      if (link === null || !isUsableLink(link, now)) {
        throw new InvalidOrExpiredTokenError();
      }
      await this.tokens.markUsed(link.id, now);
      return {
        contactEmail: link.contactEmail,
        orders: await this.reader.guestOrders(
          link.contactEmail,
          MAX_ACCESS_ORDERS,
        ),
      };
    });
  }

  /**
   * Sends the link. A failure stays in the log, without the address, and is not retried (ADR-0110): the guest can
   * ask for another link.
   */
  private async send(contactEmail: string, token: string): Promise<void> {
    try {
      await this.email.send({
        to: contactEmail,
        subject: 'Consulta tus pedidos',
        text: [
          'Hola:',
          '',
          'Para ver los pedidos que hiciste como invitado con este correo, abre este enlace:',
          this.links.link(ORDER_ACCESS_PAGE, { token }),
          '',
          `El enlace vence en ${lifetimeInWords(this.ttlSeconds)} y sirve una sola vez. Si pides otro, este deja de funcionar.`,
          '',
          'Si no lo pediste, ignora este mensaje.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.warn(
        `Order access email was not sent: ${(error as Error).message}`,
      );
    }
  }
}
