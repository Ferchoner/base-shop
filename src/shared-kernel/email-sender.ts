/** One email to one recipient. `text` is always sent; `html` is an optional richer version of it. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * The email could not be handed to the mail server: unreachable, timed out or refused. Its message
 * never holds the recipient.
 */
export class EmailDeliveryError extends Error {}

/**
 * Sends emails (ADR-0045, ADR-0110): account emails (ADR-0046, ADR-0056) and order notifications
 * (ADR-0074). In development they go to the local catcher (Mailpit); the real provider is P-24.
 *
 * Never call it inside a transaction (ARCHITECTURE.md): send after the commit, as event handlers do. A failed
 * email is not retried (ADR-0014).
 *
 * An abstract class rather than an interface, so it can be the dependency injection token without depending
 * on NestJS.
 */
export abstract class EmailSender {
  /** Rejects with `EmailDeliveryError` when the mail server does not accept the message. */
  abstract send(message: EmailMessage): Promise<void>;
}
