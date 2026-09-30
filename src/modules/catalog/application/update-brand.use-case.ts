import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import { auditedBrandFields, findBrand } from './brand-support.js';

/** Renames a brand or changes its slug (UC-CAT-13). Without changes, nothing is saved or audited. */
@Injectable()
export class UpdateBrand {
  constructor(
    private readonly brands: BrandRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(
    id: BrandId,
    changes: { name?: string; slug?: string },
  ): Promise<void> {
    return this.transactions.run(async () => {
      const brand = await findBrand(this.brands, id);
      const before = auditedBrandFields(brand);
      if (changes.name !== undefined) brand.rename(changes.name);
      if (changes.slug !== undefined) brand.changeSlug(changes.slug);
      const audited = changesBetween(before, auditedBrandFields(brand));
      if (Object.keys(audited).length === 0) return;
      await this.brands.save(brand);
      await this.audit.record({
        action: 'brands.update',
        resource: { type: 'brand', id },
        changes: audited,
      });
    });
  }
}
