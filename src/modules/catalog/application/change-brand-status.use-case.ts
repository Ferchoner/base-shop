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
 * Deactivates a brand instead of deleting it, or reactivates it without conditions (UC-CAT-13, BR-PRD-10,
 * BR-PRD-13). An inactive brand leaves the store's list of brands; its products stay visible (ADR-0080).
 */
@Injectable()
export class ChangeBrandStatus {
  constructor(
    private readonly brands: BrandRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  deactivate(id: BrandId): Promise<void> {
    return this.change(id, 'deactivate');
  }

  reactivate(id: BrandId): Promise<void> {
    return this.change(id, 'reactivate');
  }

  private change(
    id: BrandId,
    action: 'deactivate' | 'reactivate',
  ): Promise<void> {
    return this.transactions.run(async () => {
      const brand = await findBrand(this.brands, id);
      const before = auditedBrandFields(brand);
      if (action === 'deactivate') brand.deactivate();
      else brand.reactivate();
      await this.brands.save(brand);
      await this.audit.record({
        action: `brands.${action}`,
        resource: { type: 'brand', id },
        changes: changesBetween(before, auditedBrandFields(brand)),
      });
    });
  }
}
