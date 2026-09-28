import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  newId,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { AddressFields, AddressId } from '../domain/address-book.js';
import { AddressBookRepository } from '../domain/address-book.repository.js';
import { InvalidAddressLocationError } from '../domain/identity-errors.js';
import type { UserId } from '../domain/user.js';
import { AddressLocations, MAX_ADDRESSES } from './address-locations.js';

/**
 * Adds an address to the customer's address book (UC-IAM-11): an active municipality of the chosen state,
 * within the limit; the first one becomes the default.
 */
@Injectable()
export class AddAddress {
  constructor(
    private readonly books: AddressBookRepository,
    private readonly locations: AddressLocations,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    @Inject(MAX_ADDRESSES) private readonly limit: number,
  ) {}

  async execute(input: {
    customerId: UserId;
    fields: AddressFields;
    makeDefault: boolean;
  }): Promise<AddressId> {
    const problem = await this.locations.check(
      input.fields.stateCode,
      input.fields.municipalityCode,
    );
    if (problem !== null) throw new InvalidAddressLocationError(problem);
    return this.transactions.run(async () => {
      const book = await this.books.loadForUpdate(input.customerId, this.limit);
      const address = book.add(newId(), input.fields, {
        makeDefault: input.makeDefault,
        now: this.clock.now(),
      });
      await this.books.save(book);
      return address.id;
    });
  }
}
