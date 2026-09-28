import { Inject, Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared-kernel/index.js';
import type { AddressId } from '../domain/address-book.js';
import { AddressBookRepository } from '../domain/address-book.repository.js';
import type { UserId } from '../domain/user.js';
import { MAX_ADDRESSES } from './address-locations.js';

/**
 * Removes an address of the customer's book (UC-IAM-11). If it was the default, none is left as the default
 * (ADR-0071). Orders keep their own copy of the address.
 */
@Injectable()
export class RemoveAddress {
  constructor(
    private readonly books: AddressBookRepository,
    private readonly transactions: TransactionManager,
    @Inject(MAX_ADDRESSES) private readonly limit: number,
  ) {}

  execute(input: { customerId: UserId; addressId: AddressId }): Promise<void> {
    return this.transactions.run(async () => {
      const book = await this.books.loadForUpdate(input.customerId, this.limit);
      book.remove(input.addressId);
      await this.books.save(book);
    });
  }
}
