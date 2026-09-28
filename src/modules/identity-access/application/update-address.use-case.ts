import { Inject, Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared-kernel/index.js';
import type { AddressFields, AddressId } from '../domain/address-book.js';
import { AddressBookRepository } from '../domain/address-book.repository.js';
import { InvalidAddressLocationError } from '../domain/identity-errors.js';
import type { UserId } from '../domain/user.js';
import { AddressLocations, MAX_ADDRESSES } from './address-locations.js';

/**
 * Changes an address of the customer's book (UC-IAM-11). A new state or municipality must be an active
 * municipality of the state; an address that keeps its municipality may keep one INEGI retired
 * (BR-ADR-03). `makeDefault: false` on the default leaves no default (ADR-0113).
 */
@Injectable()
export class UpdateAddress {
  constructor(
    private readonly books: AddressBookRepository,
    private readonly locations: AddressLocations,
    private readonly transactions: TransactionManager,
    @Inject(MAX_ADDRESSES) private readonly limit: number,
  ) {}

  execute(input: {
    customerId: UserId;
    addressId: AddressId;
    changes: Partial<AddressFields>;
    makeDefault?: boolean;
  }): Promise<void> {
    return this.transactions.run(async () => {
      const book = await this.books.loadForUpdate(input.customerId, this.limit);
      const current = book.find(input.addressId);
      const stateCode = input.changes.stateCode ?? current.stateCode;
      const municipalityCode =
        input.changes.municipalityCode ?? current.municipalityCode;
      const locationChanged =
        stateCode !== current.stateCode ||
        municipalityCode !== current.municipalityCode;
      if (locationChanged) {
        const problem = await this.locations.check(stateCode, municipalityCode);
        if (problem !== null) throw new InvalidAddressLocationError(problem);
      }
      book.update(input.addressId, input.changes, input.makeDefault);
      await this.books.save(book);
    });
  }
}
