import { Injectable } from '@nestjs/common';
import {
  AuditTrail,
  changesBetween,
  TransactionManager,
} from '../../../shared-kernel/index.js';
import type { CategoryId } from '../domain/category.js';
import { CategoryRepository } from '../domain/category.repository.js';
import { ProductSearchIndex } from './product-search-index.js';
import { auditedFields, findCategory } from './category-support.js';

/**
 * Deactivates a category instead of deleting it (UC-CAT-12, BR-PRD-10). It and its subtree leave the store's
 * tree; their products stay visible (ADR-0080). The store sees it when its cache expires (ADR-0076).
 */
@Injectable()
export class DeactivateCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly searchIndex: ProductSearchIndex,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  execute(id: CategoryId): Promise<void> {
    return this.transactions.run(async () => {
      const category = await findCategory(this.categories, id);
      const before = auditedFields(category);
      category.deactivate();
      await this.categories.save(category);
      // Which categories are visible changed, and the search uses only visible ones (ADR-0080).
      await this.searchIndex.refreshCategories([id]);
      await this.audit.record({
        action: 'categories.deactivate',
        resource: { type: 'category', id },
        changes: changesBetween(before, auditedFields(category)),
      });
    });
  }
}
