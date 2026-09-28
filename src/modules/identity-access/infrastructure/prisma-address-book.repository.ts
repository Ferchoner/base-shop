import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { NotFoundError, toId } from '../../../shared-kernel/index.js';
import { type Address, AddressBook } from '../domain/address-book.js';
import { AddressBookRepository } from '../domain/address-book.repository.js';
import type { UserId } from '../domain/user.js';

/** `customer_addresses` (DATABASE.md §3.5), always through the active transaction. */
@Injectable()
export class PrismaAddressBookRepository extends AddressBookRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async loadForUpdate(customerId: UserId, limit: number): Promise<AddressBook> {
    const tx = this.txHost.tx;
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${customerId}::uuid AND type = 'CUSTOMER' FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('Customer', customerId);
    const rows = await tx.customerAddress.findMany({
      where: { userId: customerId },
    });
    const addresses: Address[] = rows.map((row) => ({
      id: toId<'Address'>(row.id),
      recipientName: row.recipientName,
      phone: row.phone,
      street: row.street,
      exteriorNumber: row.exteriorNumber,
      interiorNumber: row.interiorNumber,
      neighborhood: row.neighborhood,
      postalCode: row.postalCode,
      stateCode: row.stateCode,
      municipalityCode: row.municipalityCode,
      city: row.city,
      references: row.references,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
    }));
    return AddressBook.restore(customerId, addresses, limit);
  }

  async save(book: AddressBook): Promise<void> {
    const tx = this.txHost.tx;
    if (book.removedIds.size > 0) {
      await tx.customerAddress.deleteMany({
        where: { userId: book.customerId, id: { in: [...book.removedIds] } },
      });
    }
    const stored = new Set(
      (
        await tx.customerAddress.findMany({
          where: { userId: book.customerId },
          select: { id: true },
        })
      ).map(({ id }) => id),
    );
    // One default per customer is a unique index checked on every statement, so the addresses that stop
    // being the default are written before the one that becomes it.
    const changed = book.addresses
      .filter((address) => book.changedIds.has(address.id))
      .sort((a, b) => Number(a.isDefault) - Number(b.isDefault));
    for (const { id, createdAt, ...fields } of changed) {
      if (stored.has(id)) {
        await tx.customerAddress.update({ where: { id }, data: fields });
      } else {
        await tx.customerAddress.create({
          data: { id, userId: book.customerId, createdAt, ...fields },
        });
      }
    }
  }
}
