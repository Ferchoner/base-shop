import type { AddressBook } from './address-book.js';
import type { UserId } from './user.js';

/**
 * Stored address books (`customer_addresses`, DATABASE.md §3.5). An abstract class rather than an interface,
 * so it can be the dependency injection token without depending on NestJS.
 */
export abstract class AddressBookRepository {
  /**
   * The customer's address book, with the customer row locked until the transaction ends (`SELECT … FOR
   * UPDATE`), so the limit and the single default hold under concurrent changes (BR-ADR-04). Rejects with
   * `NotFoundError` when the customer does not exist.
   */
  abstract loadForUpdate(
    customerId: UserId,
    limit: number,
  ): Promise<AddressBook>;

  /** Writes only the created, modified and removed addresses. */
  abstract save(book: AddressBook): Promise<void>;
}
