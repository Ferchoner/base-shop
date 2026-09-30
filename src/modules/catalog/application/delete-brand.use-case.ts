import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { BrandId } from '../domain/brand.js';
import { BrandRepository } from '../domain/brand.repository.js';
import { auditedBrandFields, findBrand } from './brand-support.js';

/**
 * Deletes a brand without products (UC-CAT-13, BR-PRD-10); otherwise it is deactivated. The foreign key of
 * the database is what guarantees it (DATABASE.md §4.3).
 */
@Injectable()
export class DeleteBrand {
  constructor(
    private readonly brands: BrandRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(id: BrandId): Promise<void> {
    return this.transactions.run(async () => {
      const brand = await findBrand(this.brands, id);
      await this.brands.delete(brand);
      await this.audit.record({
        action: 'brands.delete',
        resource: { type: 'brand', id },
        changes: changesBetween(auditedBrandFields(brand), {}),
      });
    });
  }
}
