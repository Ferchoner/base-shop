import type { Id, OneTimeLink } from '../../../shared-kernel/index.js';

export type OrderAccessTokenId = Id<'OrderAccessToken'>;

/**
 * A link to the guest orders of an email, sent to that email (UC-ORD-05, ADR-0148), as stored: only the SHA-256 of
 * its token (DATABASE.md §8.4).
 */
export interface OrderAccessToken extends OneTimeLink {
  readonly id: OrderAccessTokenId;
  /** Normalized, as the contact email of an order. */
  readonly contactEmail: string;
  readonly tokenHash: string;
}

/**
 * Stored access links (`order_access_tokens`). An abstract class rather than an interface, so it can be the
 * dependency injection token without depending on NestJS.
 */
export abstract class OrderAccessTokenRepository {
  /**
   * Takes the lock of the email until the transaction ends. Issuing a link and anonymizing the guest take it, so a
   * link is never left behind for the orders of an anonymized guest, and two requests never leave two links.
   */
  abstract lockEmail(contactEmail: string): Promise<void>;

  abstract add(
    token: Omit<OrderAccessToken, 'usedAt' | 'invalidatedAt'>,
  ): Promise<void>;

  /** The link with this hash, its row locked until the transaction ends, so it is used only once. */
  abstract findByHashForUpdate(
    tokenHash: string,
  ): Promise<OrderAccessToken | null>;

  abstract markUsed(id: OrderAccessTokenId, at: Date): Promise<void>;

  /** Invalidates the links of the email not yet used: a new link replaces them. */
  abstract invalidatePendingOf(contactEmail: string, at: Date): Promise<void>;

  /**
   * Deletes every link of the email, in any state, when the guest is anonymized (ADR-0067, ADR-0148), after taking
   * the lock of the email: a link being issued is deleted too.
   */
  abstract deleteOf(contactEmail: string): Promise<void>;
}
