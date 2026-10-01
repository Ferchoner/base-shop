import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { PrismaTransactionAdapter } from '../../../platform/persistence/transactional-plugin.js';
import { toId } from '../../../shared-kernel/index.js';
import type { PriceListId } from '../domain/price-list.js';
import { PriceListRepository } from '../domain/price-list.repository.js';

/** `price_lists` (DATABASE.md §5.1), always through the active transaction. */
@Injectable()
export class PrismaPriceListRepository extends PriceListRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {
    super();
  }

  async exists(id: PriceListId): Promise<boolean> {
    return (await this.txHost.tx.priceList.count({ where: { id } })) > 0;
  }

  async findDefault(): Promise<PriceListId | null> {
    const row = await this.txHost.tx.priceList.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return row === null ? null : toId<'PriceList'>(row.id);
  }
}
