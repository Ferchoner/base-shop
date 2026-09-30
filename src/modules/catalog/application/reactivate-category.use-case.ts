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
 * Reactivates an inactive category whose parent is active or that is a root, without reactivating its
 * subcategories (UC-CAT-12, BR-PRD-13, ADR-0076).
 */
@Injectable()
export class ReactivateCategory {
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
      const parent =
        category.parentId === null
          ? null
          : await findCategory(this.categories, category.parentId);
      category.reactivate(parent?.status ?? null);
      await this.categories.save(category);
      // Which categories are visible changed, and the search uses only visible ones (ADR-0080).
      await this.searchIndex.refreshCategories([id]);
      await this.audit.record({
        action: 'categories.reactivate',
        resource: { type: 'category', id },
        changes: changesBetween(before, auditedFields(category)),
      });
    });
  }
}
